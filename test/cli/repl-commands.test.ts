import { describe, expect, it, vi } from 'vitest';
import { dispatchReplCommand, REPL_COMMANDS, type ReplCommandContext } from '../../src/cli/repl-commands.js';
import type { PermissionMode } from '../../src/permission/mode.js';

function fakeCtx(overrides: Partial<ReplCommandContext> = {}): ReplCommandContext & { printed: string[] } {
  const printed: string[] = [];
  let mode: PermissionMode = 'default';
  return {
    printed,
    print: (text) => printed.push(text),
    resetState: vi.fn(),
    requestAbort: vi.fn(),
    requestExit: vi.fn(),
    getMode: () => mode,
    setMode: (m) => {
      mode = m;
    },
    ...overrides,
  };
}

describe('dispatchReplCommand', () => {
  it('returns false (falls through) for plain chat input that does not start with "/"', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('hello there', ctx)).toBe(false);
    expect(ctx.printed).toEqual([]);
  });

  it('/help prints every registered command', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/help', ctx)).toBe(true);
    expect(ctx.printed).toHaveLength(1);
    for (const command of REPL_COMMANDS) {
      expect(ctx.printed[0]).toContain(command.name);
    }
  });

  it('/clear resets state and confirms', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/clear', ctx)).toBe(true);
    expect(ctx.resetState).toHaveBeenCalledOnce();
    expect(ctx.printed).toContain('Conversation cleared.');
  });

  it('/abort calls requestAbort', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/abort', ctx)).toBe(true);
    expect(ctx.requestAbort).toHaveBeenCalledOnce();
  });

  it('/exit calls requestExit', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/exit', ctx)).toBe(true);
    expect(ctx.requestExit).toHaveBeenCalledOnce();
  });

  it('/mode with no argument prints the current mode', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/mode', ctx)).toBe(true);
    expect(ctx.printed).toEqual(['Current mode: default']);
  });

  it('/mode <valid> switches the mode', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/mode acceptEdits', ctx)).toBe(true);
    expect(ctx.getMode()).toBe('acceptEdits');
    expect(ctx.printed).toEqual(['Mode set to "acceptEdits".']);
  });

  it('/mode <invalid> rejects with the list of valid modes, does not change the mode', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/mode badname', ctx)).toBe(true);
    expect(ctx.getMode()).toBe('default');
    expect(ctx.printed[0]).toContain('Unknown mode "badname"');
    expect(ctx.printed[0]).toContain('bypass');
  });

  it('an unrecognized slash command is still treated as handled (not sent as a chat message)', () => {
    const ctx = fakeCtx();
    expect(dispatchReplCommand('/nope', ctx)).toBe(true);
    expect(ctx.printed[0]).toContain('Unknown command "/nope"');
  });
});
