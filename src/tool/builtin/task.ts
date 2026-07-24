import { z } from 'zod';

import type { RunContext } from '../../types/abort.js';
import type { Message, TextBlock } from '../../types/message.js';
import { toSessionID, type SessionID } from '../../types/ids.js';
import type { AgentInfo } from '../../agent/types.js';
import { resolveModel, resolvePermission, resolvePrompt } from '../../agent/resolvers.js';
import { initialEpoch } from '../../context/epoch.js';
import type { TokenCounter } from '../../context/token-counter.js';
import type { LlmProvider } from '../../llm/types.js';
import { PermissionManager } from '../../permission/manager.js';
import type { PermissionMode } from '../../permission/mode.js';
import type { Ruleset } from '../../permission/types.js';
import {
  runOuterLoop,
  type PendingMessagesQueue,
  type RunLoopConfig,
  type RunLoopMutableState,
  type RunLoopStaticInput,
  type ToolExecutionDeps,
} from '../../core/run-loop.js';
import type { SessionRunState } from '../../core/session-run-state.js';
import type { ToolDef, ToolResult } from '../types.js';
import { ToolRegistry } from '../registry.js';

export const TASK_PARAMS = z.object({
  subagent_type: z.string(),
  description: z.string(),
  prompt: z.string(),
  /** 后台运行句柄；本迭代不实现，传入即报未实现（见 AgentInfo.background）。 */
  task_id: z.string().optional(),
});

export type TaskParams = z.infer<typeof TASK_PARAMS>;

export interface AgentLookup {
  get(name: string): AgentInfo | undefined;
}

/** 只读接口：task 工具依赖的父会话共享环境（不含 agent 专属字段）。 */
export type TaskContextBase = Pick<
  RunLoopStaticInput,
  'soulText' | 'projectDocText' | 'skillsVerboseText' | 'mcpText' | 'memorySnapshotText' | 'computeEnvText'
> & {
  defaultModel: { id: string };
  provider: LlmProvider;
  tokenCounter: TokenCounter;
  config: RunLoopConfig;
};

export interface TaskToolDeps {
  agents: AgentLookup;
  /** 全量工具注册表（子 agent 按解析出的 ruleset 过滤子集）。 */
  toolRegistry: ToolRegistry;
  /** 父会话的完整 ruleset——deriveSubagentSessionPermission 的输入。 */
  parentRuleset: Ruleset;
  context: TaskContextBase;
  /** 子会话单飞登记（不影响父 runner）。 */
  sessionRunState?: SessionRunState;
  /** 挂起审批通道；子 agent 权限一般已被 deny-only 收窄，极少触达 ask。 */
  manager?: PermissionManager;
  mode?: PermissionMode;
  /** 子 session id 后缀生成器，默认用调用计数（禁止 Date.now()/随机数参与可复现路径）。 */
  nextSuffix?: () => string;
}

function extractLastAssistantText(messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) {
    return '';
  }
  return lastAssistant.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function makeCounterSuffix(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return String(n);
  };
}

/**
 * `task` 工具：主 agent 递归委派子 agent 并阻塞等待其结果。
 *
 * - 深度检查：`ctx.depth > 0` 直接拒绝——子 agent 物理上也不会拿到 `task`
 *   工具（见 subagent-permissions deny-only），此处是运行时兜底防线。
 * - 子会话是全新 session（独立 epoch/messages），不 fork 父历史；父上下文
 *   只会看到本函数返回的 `<task_result>` 摘要，子内部的工具调用/中间消息
 *   留在子 session 里，不回灌父会话。
 * - `background`/`task_id` 均未实现：传入 `task_id` 直接返回明确的
 *   "未实现" 错误，不静默忽略。
 */
export function createTaskTool(deps: TaskToolDeps): ToolDef<TaskParams> {
  const nextSuffix = deps.nextSuffix ?? makeCounterSuffix();
  const manager = deps.manager ?? new PermissionManager();

  return {
    id: 'task',
    description: 'Delegate a task to a subagent and wait for its result.',
    parameters: TASK_PARAMS,
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: true,
    execute: async (params, ctx: RunContext): Promise<ToolResult> => {
      if (params.task_id !== undefined) {
        return {
          output: 'task tool: background task_id resumption is not implemented in this iteration.',
          metadata: { error: 'not_implemented' },
        };
      }

      if (ctx.depth > 0) {
        return {
          output: 'task tool is not available to subagents (max recursion depth reached).',
          metadata: { error: 'max_depth' },
        };
      }

      const agent = deps.agents.get(params.subagent_type);
      if (!agent) {
        return {
          output: `Unknown subagent_type "${params.subagent_type}".`,
          metadata: { error: 'unknown_subagent_type' },
        };
      }

      const childSessionID: SessionID = toSessionID(`${ctx.sessionID}::task::${nextSuffix()}`);
      const childRuleset = resolvePermission(agent, deps.parentRuleset);
      const childTools = deps.toolRegistry.getTools(childRuleset);

      const staticInput: RunLoopStaticInput = {
        model: { id: resolveModel(agent, deps.context.defaultModel.id) },
        agentPrompt: resolvePrompt(agent),
        soulText: deps.context.soulText,
        projectDocText: deps.context.projectDocText,
        skillsVerboseText: deps.context.skillsVerboseText,
        mcpText: deps.context.mcpText,
        memorySnapshotText: deps.context.memorySnapshotText,
        computeEnvText: deps.context.computeEnvText,
        tools: childTools,
        provider: deps.context.provider,
        tokenCounter: deps.context.tokenCounter,
        config: deps.context.config,
      };

      const toolDeps: ToolExecutionDeps = {
        registry: deps.toolRegistry,
        ruleset: childRuleset,
        approved: { rules: [] },
        manager,
        mode: deps.mode ?? 'default',
      };

      const childCtx: RunContext = {
        signal: ctx.signal,
        sessionID: childSessionID,
        depth: ctx.depth + 1,
        permission: { mode: ctx.permission.mode, sessionID: childSessionID },
      };

      deps.sessionRunState?.getRunner(childSessionID);

      const state: RunLoopMutableState = {
        epoch: initialEpoch(),
        messages: [{ role: 'user', seq: 1, content: [{ type: 'text', text: params.prompt }] }],
        nextSeq: 2,
      };
      const emptyQueue: PendingMessagesQueue = { drain: () => [] };

      const result = await runOuterLoop(state, childCtx, staticInput, toolDeps, emptyQueue);
      const text = extractLastAssistantText(result.state.messages);

      return {
        output: `<task_result>\n${text}\n</task_result>`,
        metadata: { childSessionID, terminalReason: result.decision.reason },
      };
    },
  };
}
