import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toSessionID } from '../../src/types/ids.js';
import type { RunContext } from '../../src/types/abort.js';
import type { Message } from '../../src/types/message.js';
import { initialEpoch } from '../../src/context/epoch.js';
import { TokenCounter } from '../../src/context/token-counter.js';
import { ToolRegistry } from '../../src/tool/registry.js';
import type { ToolDef } from '../../src/tool/types.js';
import { PermissionManager } from '../../src/permission/manager.js';
import type { Ruleset } from '../../src/permission/types.js';
import { HookRegistry } from '../../src/hooks/registry.js';
import { createMockProvider } from '../../src/llm/mock-provider.js';
import type { LlmEvent } from '../../src/llm/types.js';
import { ContentFilterError, ContextLengthExceededError, OverloadError, RateLimitError } from '../../src/llm/errors.js';
import {
  buildLlmRequest,
  consumeLlmStream,
  decideCompaction,
  executeToolUses,
  resolveToolPermission,
  runInnerLoop,
  type RunLoopConfig,
  type RunLoopStaticInput,
  type ToolExecutionDeps,
} from '../../src/core/run-loop.js';

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('s1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('s1') },
    ...overrides,
  };
}

function msg(seq: number, role: Message['role'], text: string): Message {
  return { role, seq, content: [{ type: 'text', text }] };
}

describe('decideCompaction', () => {
  it('skips when under the token threshold', () => {
    const counter = new TokenCounter(() => 10);
    const result = decideCompaction({
      messages: [msg(1, 'user', 'a'), msg(2, 'assistant', 'b')],
      epoch: initialEpoch(),
      tokenCounter: counter,
      contextLimit: 100_000,
      maxOutputTokens: 4_000,
      nextSeq: 3,
    });
    expect(result.compacted).toBe(false);
    expect(result.epoch.baselineSeq).toBe(0);
  });

  it('compacts and advances baselineSeq once over threshold', () => {
    const counter = new TokenCounter(() => 200_000);
    const result = decideCompaction({
      messages: [msg(1, 'user', 'a'), msg(2, 'assistant', 'b')],
      epoch: initialEpoch(),
      tokenCounter: counter,
      contextLimit: 100_000,
      maxOutputTokens: 4_000,
      nextSeq: 3,
    });
    expect(result.compacted).toBe(true);
    expect(result.epoch.baselineSeq).toBe(3);
    expect(result.messages).toHaveLength(1);
    expect(result.nextSeq).toBe(4);
  });

  it('force:true compacts regardless of token count', () => {
    const counter = new TokenCounter(() => 1);
    const result = decideCompaction({
      messages: [msg(1, 'user', 'a')],
      epoch: initialEpoch(),
      tokenCounter: counter,
      contextLimit: 100_000,
      maxOutputTokens: 4_000,
      nextSeq: 2,
      force: true,
    });
    expect(result.compacted).toBe(true);
  });

  it('does nothing on an empty message list', () => {
    const counter = new TokenCounter(() => 1);
    const result = decideCompaction({
      messages: [],
      epoch: initialEpoch(),
      tokenCounter: counter,
      contextLimit: 100,
      maxOutputTokens: 4_000,
      nextSeq: 1,
    });
    expect(result.compacted).toBe(false);
  });
});

describe('buildLlmRequest', () => {
  it('does not duplicate history into the system string; history goes into request.messages', () => {
    const history = [msg(1, 'user', 'hello there')];
    const request = buildLlmRequest({
      model: { id: 'claude-sonnet-5' },
      soulText: 'SOUL',
      projectDocText: '',
      skillsVerboseText: '',
      memorySnapshotText: '',
      envText: '<env/>',
      epoch: initialEpoch(),
      messages: history,
      tools: [],
    });
    expect(request.system).not.toContain('hello there');
    expect(request.messages).toEqual(history);
  });

  it('only exposes messages at/after epoch.baselineSeq', () => {
    const history = [msg(1, 'user', 'old'), msg(2, 'assistant', 'summary')];
    const request = buildLlmRequest({
      model: { id: 'claude-sonnet-5' },
      soulText: '',
      projectDocText: '',
      skillsVerboseText: '',
      memorySnapshotText: '',
      envText: '',
      epoch: { baselineSeq: 2 },
      messages: history,
      tools: [],
    });
    expect(request.messages).toEqual([msg(2, 'assistant', 'summary')]);
  });
});

describe('consumeLlmStream', () => {
  it('accumulates text_delta and tool_call events into content blocks', async () => {
    const events: LlmEvent[] = [
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'tool_call', id: 't1', name: 'read', input: { path: 'x' } },
      { type: 'finish', reason: 'tool_use' },
    ];
    const provider = createMockProvider(events);
    const controller = new AbortController();
    const request = { model: 'm', system: '', messages: [], tools: [] };

    const turn = await consumeLlmStream(provider, request, controller.signal);
    expect(turn.content).toEqual([
      { type: 'text', text: 'Hello world' },
      { type: 'tool_use', id: 't1', name: 'read', input: { path: 'x' } },
    ]);
    expect(turn.finishReason).toBe('tool_use');
    expect(turn.aborted).toBe(false);
  });

  it('invokes onTextDelta with each text chunk as it arrives, in order', async () => {
    const events: LlmEvent[] = [
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'finish', reason: 'end_turn' },
    ];
    const provider = createMockProvider(events);
    const controller = new AbortController();
    const request = { model: 'm', system: '', messages: [], tools: [] };

    const received: string[] = [];
    const turn = await consumeLlmStream(provider, request, controller.signal, (text) => received.push(text));

    expect(received).toEqual(['Hello', ' world']);
    expect(turn.content).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('marks aborted when the signal fires mid-stream', async () => {
    const events: LlmEvent[] = [
      { type: 'text_delta', text: 'a' },
      { type: 'text_delta', text: 'b' },
      { type: 'finish', reason: 'end_turn' },
    ];
    const provider = createMockProvider(events);
    const controller = new AbortController();
    controller.abort();

    const turn = await consumeLlmStream(provider, { model: 'm', system: '', messages: [], tools: [] }, controller.signal);
    expect(turn.aborted).toBe(true);
  });
});

function makeToolDeps(overrides: Partial<ToolExecutionDeps> = {}): ToolExecutionDeps {
  const registry = new ToolRegistry();
  const readTool: ToolDef<{ path: string }> = {
    id: 'read',
    description: 'read',
    parameters: z.object({ path: z.string() }),
    isReadOnly: true,
    isConcurrencySafe: true,
    execute: async (params) => ({ output: `contents of ${params.path}` }),
  };
  registry.register(readTool);

  const ruleset: Ruleset = { rules: [{ action: 'read', pattern: '*', decision: 'allow' }] };
  return {
    registry,
    ruleset,
    approved: { rules: [] },
    manager: new PermissionManager(),
    mode: 'default',
    ...overrides,
  };
}

describe('resolveToolPermission / executeToolUses', () => {
  it('synthesizes an is_error tool_result for an unknown tool name (no throw)', async () => {
    const deps = makeToolDeps();
    const results = await executeToolUses(
      [{ type: 'tool_use', id: 'x1', name: 'does-not-exist', input: {} }],
      ctx(),
      deps,
    );
    expect(results).toEqual([
      { type: 'tool_result', tool_use_id: 'x1', content: expect.stringContaining('Unknown tool'), is_error: true },
    ]);
  });

  it('synthesizes an is_error tool_result when permission denies the call', async () => {
    const deps = makeToolDeps({ ruleset: { rules: [{ action: 'read', pattern: '*', decision: 'deny' }] } });
    const results = await executeToolUses(
      [{ type: 'tool_use', id: 'x1', name: 'read', input: { path: 'a.txt' } }],
      ctx(),
      deps,
    );
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain('Permission denied');
  });

  it('executes an allowed tool call via the orchestrator and returns its output', async () => {
    const deps = makeToolDeps();
    const results = await executeToolUses(
      [{ type: 'tool_use', id: 'x1', name: 'read', input: { path: 'a.txt' } }],
      ctx(),
      deps,
    );
    expect(results).toEqual([{ type: 'tool_result', tool_use_id: 'x1', content: 'contents of a.txt', is_error: false }]);
  });

  it('preserves original call order across mixed unknown/denied/allowed tool_use blocks', async () => {
    // resolveToolPermission matches on the tool's own name (not derived from
    // input), consistent with tool/registry.ts's own allow-list matching.
    const deps = makeToolDeps({ ruleset: { rules: [{ action: 'read', pattern: 'read', decision: 'deny' }] } });
    const results = await executeToolUses(
      [
        { type: 'tool_use', id: '1', name: 'missing-tool', input: {} },
        { type: 'tool_use', id: '2', name: 'read', input: { path: 'a.txt' } },
      ],
      ctx(),
      deps,
    );
    expect(results.map((r) => r.tool_use_id)).toEqual(['1', '2']);
    expect(results[0].is_error).toBe(true);
    expect(results[1].is_error).toBe(true);
  });

  it('resolveToolPermission awaits manager.ask() when the gate returns ask', async () => {
    const deps = makeToolDeps({ ruleset: { rules: [{ action: 'read', pattern: '*', decision: 'ask' }] } });
    const runContext = ctx();
    const promise = resolveToolPermission({ type: 'tool_use', id: 'x1', name: 'read', input: {} }, runContext, deps);

    // settle it like an external CLI/gateway reply would
    deps.manager.settle('x1', 'allow');
    await expect(promise).resolves.toBe('allow');
  });

  it('a PreToolUse hook returning deny overrides a gate allow (hooks can only tighten)', async () => {
    const hooks = new HookRegistry();
    hooks.register({ event: 'PreToolUse', handle: () => ({ permissionDecision: 'deny' }) });
    const deps = makeToolDeps({ hooks });

    const results = await executeToolUses(
      [{ type: 'tool_use', id: 'x1', name: 'read', input: { path: 'a.txt' } }],
      ctx(),
      deps,
    );
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain('Permission denied');
  });

  it('a PreToolUse hook returning allow does not override a gate deny', async () => {
    const hooks = new HookRegistry();
    hooks.register({ event: 'PreToolUse', handle: () => ({ permissionDecision: 'allow' }) });
    const deps = makeToolDeps({ hooks, ruleset: { rules: [{ action: 'read', pattern: '*', decision: 'deny' }] } });

    const results = await executeToolUses(
      [{ type: 'tool_use', id: 'x1', name: 'read', input: { path: 'a.txt' } }],
      ctx(),
      deps,
    );
    expect(results[0].is_error).toBe(true);
  });

  it('fires a PostToolUse hook after a successful tool call, without affecting the result', async () => {
    const postToolCalls: string[] = [];
    const hooks = new HookRegistry();
    hooks.register({
      event: 'PostToolUse',
      handle: (hookCtx) => {
        postToolCalls.push(hookCtx.toolId);
        return {};
      },
    });
    const deps = makeToolDeps({ hooks });

    const results = await executeToolUses(
      [{ type: 'tool_use', id: 'x1', name: 'read', input: { path: 'a.txt' } }],
      ctx(),
      deps,
    );
    expect(results[0].is_error).toBe(false);
    // fire-and-forget: give the microtask queue a tick to run the hook.
    await Promise.resolve();
    expect(postToolCalls).toEqual(['read']);
  });
});

function baseStaticInput(overrides: Partial<RunLoopStaticInput> = {}): RunLoopStaticInput {
  return {
    model: { id: 'claude-sonnet-5' },
    soulText: '',
    projectDocText: '',
    skillsVerboseText: '',
    memorySnapshotText: '',
    computeEnvText: () => '<env/>',
    tools: [],
    provider: createMockProvider([{ type: 'text_delta', text: 'hi' }, { type: 'finish', reason: 'end_turn' }]),
    tokenCounter: new TokenCounter(() => 1),
    config: {
      maxTurns: 20,
      maxIterationsBeforeGrace: 20,
      contextLimit: 100_000,
      maxOutputTokens: 4_000,
      retry: { maxAttempts: 3, delayMs: 1 },
    } satisfies RunLoopConfig,
    ...overrides,
  };
}

describe('runInnerLoop error branches (§H)', () => {
  it('retries RateLimitError and eventually succeeds', async () => {
    let calls = 0;
    const provider = {
      streamChat: async function* (_req: unknown, _signal: AbortSignal) {
        calls += 1;
        if (calls < 2) {
          throw new RateLimitError();
        }
        yield { type: 'text_delta' as const, text: 'ok' };
        yield { type: 'finish' as const, reason: 'end_turn' as const };
      },
    };
    const input = baseStaticInput({ provider });
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx(),
      input,
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });
    expect(calls).toBe(2);
  });

  it('retries OverloadError and eventually succeeds', async () => {
    let calls = 0;
    const provider = {
      streamChat: async function* () {
        calls += 1;
        if (calls < 2) {
          throw new OverloadError();
        }
        yield { type: 'text_delta' as const, text: 'ok' };
        yield { type: 'finish' as const, reason: 'end_turn' as const };
      },
    };
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx(),
      baseStaticInput({ provider }),
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });
    expect(calls).toBe(2);
  });

  it('ContextLengthExceededError triggers a forced compaction then retries once', async () => {
    let calls = 0;
    const provider = {
      streamChat: async function* () {
        calls += 1;
        if (calls === 1) {
          throw new ContextLengthExceededError();
        }
        yield { type: 'text_delta' as const, text: 'ok after compaction' };
        yield { type: 'finish' as const, reason: 'end_turn' as const };
      },
    };
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi'), msg(2, 'assistant', 'prior')], nextSeq: 3 },
      ctx(),
      baseStaticInput({ provider, tokenCounter: new TokenCounter(() => 1) }),
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });
    expect(result.state.epoch.baselineSeq).toBeGreaterThan(0);
  });

  it('ContentFilterError terminates immediately with reason content_filter', async () => {
    const provider = {
      streamChat: async function* () {
        throw new ContentFilterError();
      },
    };
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx(),
      baseStaticInput({ provider }),
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'content_filter' });
  });
});

describe('runInnerLoop maxIterations ceiling + one grace call', () => {
  it('allows exactly one grace call past the ceiling before forcing max_turns', async () => {
    // Every turn emits a tool_use so the loop never naturally terminates,
    // forcing it to run until the iteration ceiling kicks in.
    let calls = 0;
    const provider = {
      streamChat: async function* () {
        calls += 1;
        yield { type: 'tool_call' as const, id: `t${calls}`, name: 'read', input: { path: 'x' } };
        yield { type: 'finish' as const, reason: 'tool_use' as const };
      },
    };
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx(),
      baseStaticInput({ provider, config: { maxTurns: 999, maxIterationsBeforeGrace: 2, contextLimit: 100_000, maxOutputTokens: 4_000 } }),
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'max_turns' });
    // ceiling=2 + 1 grace call = 3 provider calls before forced termination
    expect(calls).toBe(3);
  });
});

describe('runInnerLoop abort propagation', () => {
  it('classifies a provider exception as aborted (not model_error) when the signal was the cause', async () => {
    // Providers that actually forward the AbortSignal into their underlying HTTP
    // request (see anthropic-provider.ts / openai-compatible-provider.ts) throw
    // a generic SDK AbortError once cancelled -- run-loop must recognize this as
    // an intentional cancellation, not a real model_error, by checking
    // ctx.signal.aborted rather than trusting the exception's identity alone.
    const controller = new AbortController();
    const provider = {
      streamChat: async function* (_req: unknown, _signal: AbortSignal) {
        controller.abort();
        throw new Error('Request was aborted.');
      },
    };
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx({ signal: controller.signal }),
      baseStaticInput({ provider, config: { ...baseStaticInput().config, retry: { maxAttempts: 1, delayMs: 1 } } }),
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'aborted' });
  });

  it('stops with terminal(aborted) if ctx.signal is already aborted before the loop starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx({ signal: controller.signal }),
      baseStaticInput(),
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'aborted' });
  });

  it('stops with terminal(aborted) when the signal fires mid-stream', async () => {
    const controller = new AbortController();
    const provider = {
      streamChat: async function* (_req: unknown, signal: AbortSignal) {
        yield { type: 'text_delta' as const, text: 'partial' };
        controller.abort();
        if (signal.aborted) return;
        yield { type: 'finish' as const, reason: 'end_turn' as const };
      },
    };
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx({ signal: controller.signal }),
      baseStaticInput({ provider }),
      makeToolDeps(),
    );
    expect(result.decision).toEqual({ type: 'terminal', reason: 'aborted' });
  });

  it('does not append an empty-content assistant message when aborted before any delta arrives (would poison the next real-API call)', async () => {
    const controller = new AbortController();
    controller.abort();
    const initialMessages = [msg(1, 'user', 'hi')];
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: initialMessages, nextSeq: 2 },
      ctx({ signal: controller.signal }),
      baseStaticInput(),
      makeToolDeps(),
    );
    expect(result.state.messages).toEqual(initialMessages);
  });

  it('still appends the assistant message when abort happens after some content already arrived', async () => {
    const controller = new AbortController();
    const provider = {
      streamChat: async function* (_req: unknown, signal: AbortSignal) {
        yield { type: 'text_delta' as const, text: 'partial' };
        controller.abort();
        if (signal.aborted) return;
        yield { type: 'finish' as const, reason: 'end_turn' as const };
      },
    };
    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx({ signal: controller.signal }),
      baseStaticInput({ provider }),
      makeToolDeps(),
    );
    expect(result.state.messages).toHaveLength(2);
    expect(result.state.messages[1]).toEqual({
      role: 'assistant',
      seq: 2,
      content: [{ type: 'text', text: 'partial' }],
    });
  });
});

describe('runInnerLoop onTextDelta threading', () => {
  it('forwards text_delta chunks to staticInput.onTextDelta as the turn streams', async () => {
    const provider = createMockProvider([
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'finish', reason: 'end_turn' },
    ]);
    const received: string[] = [];

    const result = await runInnerLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx(),
      baseStaticInput({ provider, onTextDelta: (text) => received.push(text) }),
      makeToolDeps(),
    );

    expect(received).toEqual(['Hello', ' world']);
    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });
  });
});
