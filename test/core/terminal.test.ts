import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '../../src/types/message.js';
import { decideTerminal } from '../../src/core/terminal.js';

const TEXT_ONLY: ContentBlock[] = [{ type: 'text', text: 'hello' }];
const WITH_TOOL_USE: ContentBlock[] = [
  { type: 'text', text: 'let me check' },
  { type: 'tool_use', id: 't1', name: 'read', input: {} },
];

function base(overrides: Partial<Parameters<typeof decideTerminal>[0]> = {}) {
  return {
    assistantContent: TEXT_ONLY,
    finishReason: 'end_turn',
    aborted: false,
    turnCount: 1,
    maxTurns: 20,
    ...overrides,
  };
}

describe('decideTerminal', () => {
  it('continues when the assistant message contains a tool_use block, regardless of finishReason', () => {
    const result = decideTerminal(base({ assistantContent: WITH_TOOL_USE, finishReason: 'tool_use' }));
    expect(result).toEqual({ type: 'continue', reason: 'next_turn' });
  });

  it('does not trust stop_reason alone: tool_use present but finishReason says end_turn still continues', () => {
    const result = decideTerminal(base({ assistantContent: WITH_TOOL_USE, finishReason: 'end_turn' }));
    expect(result).toEqual({ type: 'continue', reason: 'next_turn' });
  });

  it('completes when there is no tool_use and finishReason is a normal end_turn', () => {
    const result = decideTerminal(base());
    expect(result).toEqual({ type: 'terminal', reason: 'completed' });
  });

  it('terminates on content_filter regardless of content', () => {
    const result = decideTerminal(base({ assistantContent: WITH_TOOL_USE, finishReason: 'content_filter' }));
    expect(result).toEqual({ type: 'terminal', reason: 'content_filter' });
  });

  it('terminates on a provider error finish reason', () => {
    const result = decideTerminal(base({ finishReason: 'error' }));
    expect(result).toEqual({ type: 'terminal', reason: 'model_error' });
  });

  it('continues with length_recovery when truncated by max_tokens and no tool_use', () => {
    const result = decideTerminal(base({ finishReason: 'max_tokens' }));
    expect(result).toEqual({ type: 'continue', reason: 'length_recovery' });
  });

  it('terminates with max_turns once turnCount reaches the ceiling', () => {
    const result = decideTerminal(base({ turnCount: 20, maxTurns: 20 }));
    expect(result).toEqual({ type: 'terminal', reason: 'max_turns' });
  });

  it('aborted takes priority over every other signal', () => {
    const result = decideTerminal(
      base({ assistantContent: WITH_TOOL_USE, finishReason: 'content_filter', aborted: true }),
    );
    expect(result).toEqual({ type: 'terminal', reason: 'aborted' });
  });
});
