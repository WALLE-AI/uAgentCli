import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { createBuiltinAgents } from '../../../src/agent/registry.js';
import type { AgentInfo } from '../../../src/agent/types.js';
import { ToolRegistry } from '../../../src/tool/registry.js';
import type { ToolDef } from '../../../src/tool/types.js';
import { TokenCounter } from '../../../src/context/token-counter.js';
import type { LlmEvent, LlmProvider, LlmRequest } from '../../../src/llm/types.js';
import { createTaskTool, type AgentLookup, type TaskContextBase } from '../../../src/tool/builtin/task.js';

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  const sessionID = toSessionID('parent-1');
  return {
    signal: new AbortController().signal,
    sessionID,
    depth: 0,
    permission: { mode: 'default', sessionID },
    ...overrides,
  };
}

function agentLookup(agents: AgentInfo[]): AgentLookup {
  const byName = new Map(agents.map((a) => [a.name, a]));
  return { get: (name) => byName.get(name) };
}

function stubReadTool(execute: ToolDef['execute'] = async () => ({ output: 'file contents' })): ToolDef {
  return {
    id: 'read',
    description: 'read a file',
    parameters: z.object({ path: z.string().optional() }),
    execute,
    isReadOnly: true,
    isConcurrencySafe: true,
    isDestructive: false,
  };
}

function stubWriteTool(execute: ToolDef['execute']): ToolDef {
  return {
    id: 'write',
    description: 'write a file',
    parameters: z.object({ path: z.string().optional(), content: z.string().optional() }),
    execute,
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: true,
  };
}

/** 按调用次序吐出不同事件序列的 provider（第一次工具调用，第二次终止文本）。 */
function sequencedProvider(turns: LlmEvent[][]): LlmProvider {
  let call = 0;
  return {
    async *streamChat(_request: LlmRequest, signal: AbortSignal) {
      const events = turns[Math.min(call, turns.length - 1)];
      call += 1;
      for (const event of events) {
        if (signal.aborted) return;
        yield event;
      }
    },
  };
}

function baseContext(provider: LlmProvider): TaskContextBase {
  return {
    defaultModel: { id: 'claude-sonnet-5' },
    soulText: '',
    projectDocText: '',
    skillsVerboseText: '',
    memorySnapshotText: '<memory>\n(none)\n</memory>',
    computeEnvText: () => '<env></env>',
    provider,
    tokenCounter: new TokenCounter(() => 1),
    config: { maxTurns: 10, maxIterationsBeforeGrace: 10, contextLimit: 200_000, maxOutputTokens: 1024 },
  };
}

const explore = createBuiltinAgents().find((a) => a.name === 'explore')!;

describe('task tool (T5.1 recursion + T5.2 explore e2e)', () => {
  it('delegates to a subagent, executes its own tool call, and returns only <task_result> text', async () => {
    const readSpy = vi.fn(async () => ({ output: 'src/index.ts contents' }));
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(stubReadTool(readSpy));
    toolRegistry.register(stubWriteTool(vi.fn()));

    const provider = sequencedProvider([
      [{ type: 'tool_call', id: 't1', name: 'read', input: { path: 'src/index.ts' } }, { type: 'finish', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'Found the entry point.' }, { type: 'finish', reason: 'end_turn' }],
    ]);

    const task = createTaskTool({
      agents: agentLookup([explore]),
      toolRegistry,
      parentRuleset: { rules: [] },
      context: baseContext(provider),
    });

    const result = await task.execute(
      { subagent_type: 'explore', description: 'find entry point', prompt: 'where is main()?' },
      ctx(),
    );

    expect(result.output).toBe('<task_result>\nFound the entry point.\n</task_result>');
    expect(readSpy).toHaveBeenCalledTimes(1);
    // 子 session 与父 session 不同——完整子 transcript 独立留存，不进父。
    expect(result.metadata?.childSessionID).not.toBe('parent-1');
    expect(String(result.metadata?.childSessionID)).toContain('parent-1::task::');
  });

  it('denies write for a read-only subagent even though the model calls it', async () => {
    const writeSpy = vi.fn(async () => ({ output: 'wrote file' }));
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(stubReadTool());
    toolRegistry.register(stubWriteTool(writeSpy));

    const provider = sequencedProvider([
      [{ type: 'tool_call', id: 't1', name: 'write', input: { path: 'x', content: 'y' } }, { type: 'finish', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'done' }, { type: 'finish', reason: 'end_turn' }],
    ]);

    const task = createTaskTool({
      agents: agentLookup([explore]),
      toolRegistry,
      parentRuleset: { rules: [] },
      context: baseContext(provider),
    });

    const result = await task.execute(
      { subagent_type: 'explore', description: 'try to write', prompt: 'write a file' },
      ctx(),
    );

    expect(writeSpy).not.toHaveBeenCalled();
    expect(result.output).toBe('<task_result>\ndone\n</task_result>');
  });

  it('denies task/todowrite for a subagent regardless of parent ruleset (deny-only inheritance)', async () => {
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(stubReadTool());

    // 父 ruleset 显式 allow task/todowrite——子会话仍必须 deny-only（见 subagent-permissions.ts）。
    const parentRuleset = {
      rules: [
        { action: 'task' as const, pattern: '*', decision: 'allow' as const },
        { action: 'todowrite' as const, pattern: '*', decision: 'allow' as const },
      ],
    };

    const provider = sequencedProvider([[{ type: 'text_delta', text: 'ok' }, { type: 'finish', reason: 'end_turn' as const }]]);
    const task = createTaskTool({ agents: agentLookup([explore]), toolRegistry, parentRuleset, context: baseContext(provider) });

    await task.execute({ subagent_type: 'explore', description: 'x', prompt: 'x' }, ctx());

    // 无法直接观察子 ruleset（不是公开返回值），但可通过 resolvePermission 的纯函数结果间接验证：
    const { resolvePermission } = await import('../../../src/agent/resolvers.js');
    const childRuleset = resolvePermission(explore, parentRuleset);
    expect(childRuleset.rules).toContainEqual({ action: 'task', pattern: '*', decision: 'deny' });
    expect(childRuleset.rules).toContainEqual({ action: 'todowrite', pattern: '*', decision: 'deny' });
  });

  it('rejects recursion when depth > 0 (subagent cannot itself call task)', async () => {
    const toolRegistry = new ToolRegistry();
    const provider = sequencedProvider([[{ type: 'text_delta', text: 'unused' }, { type: 'finish', reason: 'end_turn' }]]);
    const agents = agentLookup([explore]);
    const getSpy = vi.spyOn(agents, 'get');

    const task = createTaskTool({ agents, toolRegistry, parentRuleset: { rules: [] }, context: baseContext(provider) });

    const result = await task.execute(
      { subagent_type: 'explore', description: 'x', prompt: 'x' },
      ctx({ depth: 1 }),
    );

    expect(result.metadata?.error).toBe('max_depth');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('rejects unknown subagent_type without throwing', async () => {
    const toolRegistry = new ToolRegistry();
    const provider = sequencedProvider([[{ type: 'finish', reason: 'end_turn' }]]);
    const task = createTaskTool({
      agents: agentLookup([explore]),
      toolRegistry,
      parentRuleset: { rules: [] },
      context: baseContext(provider),
    });

    const result = await task.execute({ subagent_type: 'nope', description: 'x', prompt: 'x' }, ctx());
    expect(result.metadata?.error).toBe('unknown_subagent_type');
  });

  it('reports task_id resumption as not implemented (background is not implemented this iteration)', async () => {
    const toolRegistry = new ToolRegistry();
    const provider = sequencedProvider([[{ type: 'finish', reason: 'end_turn' }]]);
    const task = createTaskTool({
      agents: agentLookup([explore]),
      toolRegistry,
      parentRuleset: { rules: [] },
      context: baseContext(provider),
    });

    const result = await task.execute(
      { subagent_type: 'explore', description: 'x', prompt: 'x', task_id: 'bg-1' },
      ctx(),
    );
    expect(result.metadata?.error).toBe('not_implemented');
  });
});
