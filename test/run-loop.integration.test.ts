import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toSessionID } from '../src/types/ids.js';
import type { RunContext } from '../src/types/abort.js';
import type { Message, ToolResultBlock } from '../src/types/message.js';
import { initialEpoch } from '../src/context/epoch.js';
import { TokenCounter } from '../src/context/token-counter.js';
import { ToolRegistry } from '../src/tool/registry.js';
import type { ToolDef } from '../src/tool/types.js';
import { PermissionManager } from '../src/permission/manager.js';
import type { Ruleset } from '../src/permission/types.js';
import type { LlmEvent, LlmProvider, LlmRequest } from '../src/llm/types.js';
import { Runner } from '../src/core/runner.js';
import {
  runOuterLoop,
  type PendingMessagesQueue,
  type RunLoopStaticInput,
  type ToolExecutionDeps,
} from '../src/core/run-loop.js';

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

function sequenceProvider(turns: LlmEvent[][]): LlmProvider {
  let call = 0;
  return {
    async *streamChat(_request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
      const events = turns[Math.min(call, turns.length - 1)];
      call += 1;
      for (const event of events) {
        if (signal.aborted) {
          return;
        }
        yield event;
      }
    },
  };
}

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

function baseStaticInput(overrides: Partial<RunLoopStaticInput> = {}): RunLoopStaticInput {
  return {
    model: { id: 'claude-sonnet-5' },
    soulText: '',
    projectDocText: '',
    skillsVerboseText: '',
    memorySnapshotText: '',
    computeEnvText: () => '<env/>',
    tools: [],
    provider: sequenceProvider([[{ type: 'text_delta', text: 'hi' }, { type: 'finish', reason: 'end_turn' }]]),
    tokenCounter: new TokenCounter(() => 1),
    config: {
      maxTurns: 20,
      maxIterationsBeforeGrace: 20,
      contextLimit: 100_000,
      maxOutputTokens: 4_000,
      retry: { maxAttempts: 3, delayMs: 1 },
    },
    ...overrides,
  };
}

function emptyQueue(): PendingMessagesQueue {
  return { drain: () => [] };
}

describe('run-loop integration (mock provider, 5 scenarios)', () => {
  it('1. multiple concurrent tool_use -> orchestrator refills results -> continues -> terminal(completed)', async () => {
    const provider = sequenceProvider([
      [
        { type: 'tool_call', id: 't1', name: 'read', input: { path: 'a.txt' } },
        { type: 'tool_call', id: 't2', name: 'read', input: { path: 'b.txt' } },
        { type: 'finish', reason: 'tool_use' },
      ],
      [{ type: 'text_delta', text: 'all done' }, { type: 'finish', reason: 'end_turn' }],
    ]);

    const result = await runOuterLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'read both files')], nextSeq: 2 },
      ctx(),
      baseStaticInput({ provider }),
      makeToolDeps(),
      emptyQueue(),
    );

    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });

    const toolResultMessage = result.state.messages.find((m) =>
      m.content.some((b) => b.type === 'tool_result'),
    );
    const toolResultIds = toolResultMessage?.content
      .filter((b): b is ToolResultBlock => b.type === 'tool_result')
      .map((b) => b.tool_use_id);
    expect(toolResultIds).toEqual(['t1', 't2']);
  });

  it('2. steering: appending a message while running does not start a second run; it is consumed naturally', async () => {
    const pendingMessages: Message[] = [];
    const queue: PendingMessagesQueue = {
      drain: () => {
        const drained = [...pendingMessages];
        pendingMessages.length = 0;
        return drained;
      },
    };

    let resolveDelay!: () => void;
    const delay = new Promise<void>((resolve) => {
      resolveDelay = resolve;
    });
    let providerCalls = 0;

    const provider: LlmProvider = {
      async *streamChat(_request, signal) {
        providerCalls += 1;
        yield { type: 'text_delta', text: 'thinking...' };
        await delay;
        if (signal.aborted) {
          return;
        }
        yield { type: 'finish', reason: 'end_turn' };
      },
    };

    const runner = new Runner();
    const workFn = vi.fn(() =>
      runOuterLoop(
        { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
        ctx(),
        baseStaticInput({ provider }),
        makeToolDeps(),
        queue,
      ),
    );

    const first = runner.ensureRunning(workFn);
    expect(runner.getState()).toBe('running');

    // Simulate a user message arriving while the run is in flight.
    pendingMessages.push(msg(99, 'user', 'steering message'));
    const second = runner.ensureRunning(workFn);

    // Steering: no second run was started.
    expect(workFn).toHaveBeenCalledTimes(1);

    resolveDelay();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);

    const result = firstResult as Awaited<ReturnType<typeof runOuterLoop>>;
    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });
    // the steering message was naturally consumed by the outer loop's next drain
    expect(result.state.messages.some((m) => m.seq === 99)).toBe(true);
    // the outer loop had to run the inner loop twice to consume the steering message
    expect(providerCalls).toBe(2);
  });

  it('3. malformed tool_call (unknown tool name) self-corrects instead of throwing/aborting', async () => {
    const provider = sequenceProvider([
      [{ type: 'tool_call', id: 't1', name: 'does-not-exist', input: {} }, { type: 'finish', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'sorry, let me try something else' }, { type: 'finish', reason: 'end_turn' }],
    ]);

    const result = await runOuterLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'do something')], nextSeq: 2 },
      ctx(),
      baseStaticInput({ provider }),
      makeToolDeps(),
      emptyQueue(),
    );

    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });
    const errorResult = result.state.messages
      .flatMap((m) => m.content)
      .find((b) => b.type === 'tool_result' && b.is_error);
    expect(errorResult).toBeDefined();
    if (errorResult?.type === 'tool_result') {
      expect(errorResult.content).toContain('Unknown tool');
    }
  });

  it('4. exceeding the compaction threshold advances epoch.baselineSeq and shrinks visible history', async () => {
    const provider = sequenceProvider([
      [{ type: 'text_delta', text: 'ok' }, { type: 'finish', reason: 'end_turn' }],
    ]);
    const hugeTokenCounter = new TokenCounter(() => 1_000_000);

    const initialMessages = [msg(1, 'user', 'a'), msg(2, 'assistant', 'b'), msg(3, 'user', 'c')];
    const result = await runOuterLoop(
      { epoch: initialEpoch(), messages: initialMessages, nextSeq: 4 },
      ctx(),
      baseStaticInput({ provider, tokenCounter: hugeTokenCounter }),
      makeToolDeps(),
      emptyQueue(),
    );

    expect(result.decision).toEqual({ type: 'terminal', reason: 'completed' });
    expect(result.state.epoch.baselineSeq).toBeGreaterThan(0);
    // visible history no longer contains the original pre-compaction messages
    const visibleSeqs = result.state.messages
      .filter((m) => m.seq >= result.state.epoch.baselineSeq)
      .map((m) => m.seq);
    expect(visibleSeqs.every((seq) => seq >= result.state.epoch.baselineSeq)).toBe(true);
    expect(result.state.messages.some((m) => m.content.some((b) => b.type === 'text' && b.text.includes('Compacted')))).toBe(
      true,
    );
  });

  it('5a. abort before the run starts: terminal(aborted), provider never called', async () => {
    const controller = new AbortController();
    controller.abort();
    let providerCalled = false;
    const provider: LlmProvider = {
      async *streamChat() {
        providerCalled = true;
        yield { type: 'finish', reason: 'end_turn' };
      },
    };

    const result = await runOuterLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx({ signal: controller.signal }),
      baseStaticInput({ provider }),
      makeToolDeps(),
      emptyQueue(),
    );

    expect(result.decision).toEqual({ type: 'terminal', reason: 'aborted' });
    expect(providerCalled).toBe(false);
  });

  it('5b. abort mid-stream halts the run at terminal(aborted) instead of completing the turn', async () => {
    const controller = new AbortController();
    const provider: LlmProvider = {
      async *streamChat(_request, signal) {
        yield { type: 'text_delta', text: 'partial output' };
        controller.abort();
        if (signal.aborted) {
          return;
        }
        yield { type: 'finish', reason: 'end_turn' };
      },
    };

    const result = await runOuterLoop(
      { epoch: initialEpoch(), messages: [msg(1, 'user', 'hi')], nextSeq: 2 },
      ctx({ signal: controller.signal }),
      baseStaticInput({ provider }),
      makeToolDeps(),
      emptyQueue(),
    );

    expect(result.decision).toEqual({ type: 'terminal', reason: 'aborted' });
  });
});
