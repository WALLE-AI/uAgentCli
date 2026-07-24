import type { ContentBlock, Message, ToolResultBlock, ToolUseBlock } from '../types/message.js';
import type { RunContext } from '../types/abort.js';
import type { Action, Decision, Ruleset } from '../permission/types.js';
import { checkToolPermission } from '../permission/gate.js';
import type { PermissionMode } from '../permission/mode.js';
import type { PermissionManager } from '../permission/manager.js';
import type { ToolDef } from '../tool/types.js';
import { TOOL_ACTION_MAP, type ToolRegistry } from '../tool/registry.js';
import { runToolCalls, type OrchestratorTool } from '../tool/orchestrator.js';
import { wrap } from '../tool/wrap.js';
import { HookRegistry } from '../hooks/registry.js';
import { assembleContext } from '../context/pipeline.js';
import { compactEpoch, visibleHistory, type ContextEpoch } from '../context/epoch.js';
import { autoCompactDecision, applyToolResultBudget, type BudgetConfig } from '../context/budget.js';
import type { TokenCounter } from '../context/token-counter.js';
import { decideTerminal, type TerminalDecision } from './terminal.js';
import type { LlmProvider, LlmRequest } from '../llm/types.js';
import { ContentFilterError, ContextLengthExceededError, OverloadError, RateLimitError } from '../llm/errors.js';

// ---------------------------------------------------------------------------
// ① compaction
// ---------------------------------------------------------------------------

export interface DecideCompactionInput {
  messages: Message[];
  epoch: ContextEpoch;
  tokenCounter: TokenCounter;
  contextLimit: number;
  maxOutputTokens: number;
  config?: BudgetConfig;
  nextSeq: number;
  /** 强制压缩，忽略 isOverflow 判定（用于 ContextLengthExceededError 重试路径）。 */
  force?: boolean;
}

export interface DecideCompactionResult {
  epoch: ContextEpoch;
  messages: Message[];
  nextSeq: number;
  compacted: boolean;
}

/**
 * §F 压缩触发：越过阈值（或 `force`）就把当前可见历史整体折叠成一条
 * 占位摘要消息（本迭代不接真实 LLM 摘要，只验证机制：触发→baselineSeq
 * 前移，见迭代4计划的范围简化声明）。
 */
export function decideCompaction(input: DecideCompactionInput): DecideCompactionResult {
  const visible = visibleHistory(input.epoch, input.messages);
  if (visible.length === 0) {
    return { epoch: input.epoch, messages: input.messages, nextSeq: input.nextSeq, compacted: false };
  }

  const totalTokens = visible.reduce((sum, m) => sum + input.tokenCounter.count(m), 0);
  const decision = input.force
    ? 'compact'
    : autoCompactDecision({
        totalTokens,
        contextLimit: input.contextLimit,
        maxOutputTokens: input.maxOutputTokens,
        config: input.config,
      });

  if (decision === 'skip') {
    return { epoch: input.epoch, messages: input.messages, nextSeq: input.nextSeq, compacted: false };
  }

  const summaryMessage: Message = {
    role: 'assistant',
    seq: input.nextSeq,
    content: [{ type: 'text', text: `[Compacted ${visible.length} messages]` }],
  };
  const result = compactEpoch({ epoch: input.epoch, messages: input.messages, summaryMessage });
  return { epoch: result.epoch, messages: result.messages, nextSeq: input.nextSeq + 1, compacted: true };
}

// ---------------------------------------------------------------------------
// ② assemble request
// ---------------------------------------------------------------------------

export interface BuildLlmRequestInput {
  model: { id: string };
  agentPrompt?: string;
  customTemplate?: string;
  override?: string;
  soulText: string;
  projectDocText: string;
  skillsVerboseText: string;
  mcpText?: string;
  memorySnapshotText: string;
  envText: string;
  epoch: ContextEpoch;
  messages: Message[];
  tools: ToolDef[];
  maxTokens?: number;
}

/**
 * 复用 `context/pipeline.ts` 的 `assembleContext` 产出 system 字符串
 * （`historyText` 传空——可见历史改走 `LlmRequest.messages` 结构化数组，
 * 不重复塞进 system 文本，匹配 Anthropic Messages API 的真实用法）。
 */
export function buildLlmRequest(input: BuildLlmRequestInput): LlmRequest {
  const system = assembleContext({
    model: input.model,
    agentPrompt: input.agentPrompt,
    customTemplate: input.customTemplate,
    override: input.override,
    soulText: input.soulText,
    projectDocText: input.projectDocText,
    skillsVerboseText: input.skillsVerboseText,
    mcpText: input.mcpText,
    envText: input.envText,
    memorySnapshotText: input.memorySnapshotText,
    historyText: '',
  });

  return {
    model: input.model.id,
    system,
    messages: visibleHistory(input.epoch, input.messages),
    tools: input.tools,
    maxTokens: input.maxTokens,
  };
}

// ---------------------------------------------------------------------------
// ③ consume stream
// ---------------------------------------------------------------------------

export type FinishReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'content_filter' | 'error';

export interface ConsumedTurn {
  content: ContentBlock[];
  finishReason: FinishReason;
  aborted: boolean;
}

/**
 * 迭代 provider 流式事件，累积成一条 assistant 消息内容；`signal` abort
 * 时提前结束。`onTextDelta`（可选）供调用方（CLI/gateway）增量渲染
 * 文本分片，不影响这里累积的完整 `text`——两者互不依赖。
 */
export async function consumeLlmStream(
  provider: LlmProvider,
  request: LlmRequest,
  signal: AbortSignal,
  onTextDelta?: (text: string) => void,
): Promise<ConsumedTurn> {
  let text = '';
  let thinking = '';
  const toolUses: ToolUseBlock[] = [];
  let finishReason: ConsumedTurn['finishReason'] = 'error';
  let aborted = false;

  for await (const event of provider.streamChat(request, signal)) {
    if (signal.aborted) {
      aborted = true;
      break;
    }
    if (event.type === 'text_delta') {
      text += event.text;
      onTextDelta?.(event.text);
    } else if (event.type === 'thinking') {
      thinking += event.text;
    } else if (event.type === 'tool_call') {
      toolUses.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
    } else if (event.type === 'finish') {
      finishReason = event.reason;
    }
  }
  if (signal.aborted) {
    aborted = true;
  }

  const content: ContentBlock[] = [];
  if (thinking) {
    content.push({ type: 'thinking', thinking });
  }
  if (text) {
    content.push({ type: 'text', text });
  }
  content.push(...toolUses);

  return { content, finishReason, aborted };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** provider 抛出的原始异常信息——供上层（CLI/gateway）诊断 model_error，不再静默丢弃。 */
function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface RetryConfig {
  maxAttempts?: number;
  delayMs?: number;
}

/** §H：RateLimit/Overload 重试+简单退避；其余错误直接抛给调用方处理。 */
async function consumeLlmStreamWithRetry(
  provider: LlmProvider,
  request: LlmRequest,
  signal: AbortSignal,
  retry: RetryConfig = {},
  onTextDelta?: (text: string) => void,
): Promise<ConsumedTurn> {
  const maxAttempts = retry.maxAttempts ?? 3;
  const delayMs = retry.delayMs ?? 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await consumeLlmStream(provider, request, signal, onTextDelta);
    } catch (error) {
      const isRetryable = error instanceof RateLimitError || error instanceof OverloadError;
      if (isRetryable && attempt < maxAttempts) {
        await sleep(delayMs * attempt);
        continue;
      }
      throw error;
    }
  }
  throw new Error('unreachable: consumeLlmStreamWithRetry exhausted without returning or throwing');
}

// ---------------------------------------------------------------------------
// ⑤ tool execution
// ---------------------------------------------------------------------------

export interface ToolExecutionDeps {
  registry: ToolRegistry;
  ruleset: Ruleset;
  approved: Ruleset;
  manager: PermissionManager;
  mode: PermissionMode;
  /** 可选：注册了的 hook 只能收紧（deny/ask）gate 的判定，不能放宽它。 */
  hooks?: HookRegistry;
}

function resolveToolAction(toolId: string): Action {
  return TOOL_ACTION_MAP[toolId] ?? 'execute';
}

/** hook 的 `permissionDecision` 只能让判定更严格，绝不放宽 gate 已经拒绝/要求确认的结果。 */
function tightenWithHookDecision(decision: Decision, hookDecision: Decision | undefined): Decision {
  if (decision === 'deny' || !hookDecision) {
    return decision;
  }
  if (hookDecision === 'deny') {
    return 'deny';
  }
  if (hookDecision === 'ask' && decision === 'allow') {
    return 'ask';
  }
  return decision;
}

export async function resolveToolPermission(
  toolUse: ToolUseBlock,
  ctx: RunContext,
  deps: ToolExecutionDeps,
): Promise<Decision> {
  const action = resolveToolAction(toolUse.name);
  const gateDecision = checkToolPermission({
    action,
    pattern: toolUse.name,
    mode: deps.mode,
    ruleset: deps.ruleset,
    approved: deps.approved,
  });

  let decision = gateDecision;
  if (deps.hooks) {
    const hookResult = await deps.hooks.run({ event: 'PreToolUse', toolId: toolUse.name, sessionID: ctx.sessionID });
    decision = tightenWithHookDecision(decision, hookResult.permissionDecision);
  }

  if (decision !== 'ask') {
    return decision;
  }
  return deps.manager.ask({ id: toolUse.id, sessionID: ctx.sessionID, action, patterns: [toolUse.name] });
}

function deniedResult(toolUseId: string, message: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: message, is_error: true };
}

/**
 * 未知工具名/权限被拒 → 合成 `is_error` tool_result，不抛异常（允许模型
 * 下一轮自纠）；已放行的调用交给 `tool/orchestrator.ts` 批量执行；
 * 最终结果按原始 `toolUses` 顺序重排（覆盖"立即拒绝"与"编排执行"两类结果）。
 */
export async function executeToolUses(
  toolUses: ToolUseBlock[],
  ctx: RunContext,
  deps: ToolExecutionDeps,
): Promise<ToolResultBlock[]> {
  const orchestratorTools: OrchestratorTool[] = [];
  const immediate = new Map<string, ToolResultBlock>();

  for (const toolUse of toolUses) {
    const def = deps.registry.get(toolUse.name);
    if (!def) {
      immediate.set(toolUse.id, deniedResult(toolUse.id, `Unknown tool "${toolUse.name}"`));
      continue;
    }

    const decision = await resolveToolPermission(toolUse, ctx, deps);
    if (decision !== 'allow') {
      immediate.set(toolUse.id, deniedResult(toolUse.id, `Permission denied for tool "${toolUse.name}" (${decision})`));
      continue;
    }

    const wrapped = wrap(def);
    orchestratorTools.push({
      call: toolUse,
      isConcurrencySafe: def.isConcurrencySafe,
      run: (runCtx) => wrapped(toolUse.input, runCtx),
    });
  }

  const orchestrated = orchestratorTools.length > 0 ? await runToolCalls(orchestratorTools, ctx) : [];

  if (deps.hooks) {
    for (const { call } of orchestratorTools) {
      // fire-and-forget：PostToolUse 只做旁路通知，不回头影响已经产出的
      // tool_result；hook 抛错只 log，不能反过来搞垮已经成功的这次调用。
      void deps.hooks.run({ event: 'PostToolUse', toolId: call.name, sessionID: ctx.sessionID }).catch((error) => {
        console.error(`PostToolUse hook for "${call.name}" failed (ignored):`, error instanceof Error ? error.message : String(error));
      });
    }
  }

  const byId = new Map<string, ToolResultBlock>();
  for (const result of orchestrated) {
    byId.set(result.tool_use_id, result);
  }
  for (const [id, result] of immediate) {
    byId.set(id, result);
  }

  return toolUses.map((toolUse) => byId.get(toolUse.id)!);
}

// ---------------------------------------------------------------------------
// ⑥ inner loop (tool-drain) + ⑦ outer loop (steering-drain)
// ---------------------------------------------------------------------------

export interface RunLoopConfig {
  maxTurns: number;
  /** 超过这个迭代数后只再允许一次 grace call，之后强制 terminal(max_turns)。 */
  maxIterationsBeforeGrace: number;
  contextLimit: number;
  maxOutputTokens: number;
  compactionConfig?: BudgetConfig;
  retry?: RetryConfig;
}

export interface RunLoopStaticInput {
  model: { id: string };
  agentPrompt?: string;
  customTemplate?: string;
  override?: string;
  soulText: string;
  projectDocText: string;
  skillsVerboseText: string;
  mcpText?: string;
  memorySnapshotText: string;
  /** 每轮重新计算一次 env 块（cwd/日期等），保持字节稳定但内容新鲜。 */
  computeEnvText: () => string;
  tools: ToolDef[];
  provider: LlmProvider;
  tokenCounter: TokenCounter;
  config: RunLoopConfig;
  /** 增量渲染文本分片的可选回调（CLI/gateway 用来做流式输出）。 */
  onTextDelta?: (text: string) => void;
}

export interface RunLoopMutableState {
  epoch: ContextEpoch;
  messages: Message[];
  nextSeq: number;
}

function buildRequestFromState(state: RunLoopMutableState, input: RunLoopStaticInput): LlmRequest {
  return buildLlmRequest({
    model: input.model,
    agentPrompt: input.agentPrompt,
    customTemplate: input.customTemplate,
    override: input.override,
    soulText: input.soulText,
    projectDocText: input.projectDocText,
    skillsVerboseText: input.skillsVerboseText,
    mcpText: input.mcpText,
    memorySnapshotText: input.memorySnapshotText,
    envText: input.computeEnvText(),
    epoch: state.epoch,
    messages: state.messages,
    tools: input.tools,
  });
}

export interface RunInnerLoopResult {
  decision: TerminalDecision;
  state: RunLoopMutableState;
}

/**
 * 单轮 tool-drain：①压缩判定 → ②装配请求 → ③流式消费（§H 错误分支）→
 * ④终止判定 → ⑤（continue(next_turn) 时）执行工具、回填结果、继续下一轮。
 * `maxIterationsBeforeGrace` 天花板：超过后允许一次 grace call，再超则
 * 强制 terminal(max_turns)。
 */
export async function runInnerLoop(
  initialState: RunLoopMutableState,
  ctx: RunContext,
  input: RunLoopStaticInput,
  toolDeps: ToolExecutionDeps,
): Promise<RunInnerLoopResult> {
  let current = initialState;
  let turnCount = 0;
  let iterations = 0;
  let usedGrace = false;

  while (true) {
    iterations += 1;
    if (iterations > input.config.maxIterationsBeforeGrace) {
      if (usedGrace) {
        return { decision: { type: 'terminal', reason: 'max_turns' }, state: current };
      }
      usedGrace = true;
    }

    if (ctx.signal.aborted) {
      return { decision: { type: 'terminal', reason: 'aborted' }, state: current };
    }

    const compaction = decideCompaction({
      messages: current.messages,
      epoch: current.epoch,
      tokenCounter: input.tokenCounter,
      contextLimit: input.config.contextLimit,
      maxOutputTokens: input.config.maxOutputTokens,
      config: input.config.compactionConfig,
      nextSeq: current.nextSeq,
    });
    current = { epoch: compaction.epoch, messages: compaction.messages, nextSeq: compaction.nextSeq };

    const request = buildRequestFromState(current, input);

    let turn: ConsumedTurn;
    try {
      turn = await consumeLlmStreamWithRetry(input.provider, request, ctx.signal, input.config.retry, input.onTextDelta);
    } catch (error) {
      // 用户主动 abort 时，provider 把"我们把它的底层请求也取消了"这件事
      // 表现成一个普通异常（例如 SDK 的 AbortError）——这不是真正的
      // model_error，是取消的直接后果，必须归类成 aborted 而不是吓到用户。
      if (ctx.signal.aborted) {
        return { decision: { type: 'terminal', reason: 'aborted' }, state: current };
      }
      if (error instanceof ContextLengthExceededError) {
        const forced = decideCompaction({
          messages: current.messages,
          epoch: current.epoch,
          tokenCounter: input.tokenCounter,
          contextLimit: input.config.contextLimit,
          maxOutputTokens: input.config.maxOutputTokens,
          config: input.config.compactionConfig,
          nextSeq: current.nextSeq,
          force: true,
        });
        current = { epoch: forced.epoch, messages: forced.messages, nextSeq: forced.nextSeq };
        try {
          turn = await consumeLlmStream(input.provider, buildRequestFromState(current, input), ctx.signal, input.onTextDelta);
        } catch (retryError) {
          if (ctx.signal.aborted) {
            return { decision: { type: 'terminal', reason: 'aborted' }, state: current };
          }
          return {
            decision: { type: 'terminal', reason: 'model_error', detail: errorDetail(retryError) },
            state: current,
          };
        }
      } else if (error instanceof ContentFilterError) {
        return { decision: { type: 'terminal', reason: 'content_filter' }, state: current };
      } else {
        return {
          decision: { type: 'terminal', reason: 'model_error', detail: errorDetail(error) },
          state: current,
        };
      }
    }

    // 空 content（典型场景：abort 发生在任何分片到达之前）不追加进历史——
    // 真实 provider 拒绝 content/tool_calls 都为空的 assistant 消息，追加
    // 一条这样的占位消息会让*下一轮*请求直接被 API 拒绝（400），而不仅仅
    // 是当前这轮"什么都没生成"。
    if (turn.content.length > 0) {
      const assistantMessage: Message = { role: 'assistant', seq: current.nextSeq, content: turn.content };
      current = {
        epoch: current.epoch,
        messages: [...current.messages, assistantMessage],
        nextSeq: current.nextSeq + 1,
      };
    }

    turnCount += 1;
    const decision = decideTerminal({
      assistantContent: turn.content,
      finishReason: turn.finishReason,
      aborted: turn.aborted || ctx.signal.aborted,
      turnCount,
      maxTurns: input.config.maxTurns,
    });

    if (decision.type === 'terminal') {
      return { decision, state: current };
    }

    if (decision.reason === 'next_turn') {
      const toolUses = turn.content.filter((block): block is ToolUseBlock => block.type === 'tool_use');
      const results = await executeToolUses(toolUses, ctx, toolDeps);
      const [resultMessage] = applyToolResultBudget([
        { role: 'user', seq: current.nextSeq, content: results },
      ]);
      current = {
        epoch: current.epoch,
        messages: [...current.messages, resultMessage],
        nextSeq: current.nextSeq + 1,
      };
    }
    // length_recovery / compact_retry：直接进入下一轮迭代重新装配+重新请求。
  }
}

export interface PendingMessagesQueue {
  /** 取出并清空当前所有挂起的用户消息（steering：运行中追加的新消息）。 */
  drain(): Message[];
}

export interface RunOuterLoopResult {
  decision: TerminalDecision;
  state: RunLoopMutableState;
}

/**
 * steering drain：每轮先合并挂起的新用户消息，再跑一次内层 tool-drain；
 * 内层返回后若又有新消息到达（同一 tick 内追加），继续外层循环，否则
 * 返回最终判定——这是"转向而非取消重启"的落地位置。
 */
export async function runOuterLoop(
  initialState: RunLoopMutableState,
  ctx: RunContext,
  input: RunLoopStaticInput,
  toolDeps: ToolExecutionDeps,
  pending: PendingMessagesQueue,
): Promise<RunOuterLoopResult> {
  let current = initialState;

  while (true) {
    const drained = pending.drain();
    if (drained.length > 0) {
      current = {
        epoch: current.epoch,
        messages: [...current.messages, ...drained],
        nextSeq: current.nextSeq + drained.length,
      };
    }

    const result = await runInnerLoop(current, ctx, input, toolDeps);
    current = result.state;

    const more = pending.drain();
    if (more.length > 0 && !ctx.signal.aborted) {
      current = {
        epoch: current.epoch,
        messages: [...current.messages, ...more],
        nextSeq: current.nextSeq + more.length,
      };
      continue;
    }

    return { decision: result.decision, state: current };
  }
}
