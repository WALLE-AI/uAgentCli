import { describe, expect, it } from 'vitest';
import { extractFinalText, formatUsage, parseCliArgs, parseDotEnvContent } from '../../src/cli/main.js';
import type { Message } from '../../src/types/message.js';

describe('parseCliArgs', () => {
  it('parses --once "<message>" into once mode', () => {
    expect(parseCliArgs(['--once', 'list files'])).toEqual({ mode: 'once', message: 'list files' });
  });

  it('defaults to repl mode when --once is absent', () => {
    expect(parseCliArgs([])).toEqual({ mode: 'repl' });
  });

  it('falls back to repl mode when --once has no following argument', () => {
    expect(parseCliArgs(['--once'])).toEqual({ mode: 'repl' });
  });
});

describe('extractFinalText', () => {
  it('returns the text content of the last assistant message', () => {
    const messages: Message[] = [
      { role: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', seq: 2, content: [{ type: 'text', text: 'first reply' }] },
      { role: 'user', seq: 3, content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
      { role: 'assistant', seq: 4, content: [{ type: 'text', text: 'final reply' }] },
    ];
    expect(extractFinalText(messages)).toBe('final reply');
  });

  it('returns an empty string when there is no assistant message', () => {
    expect(extractFinalText([{ role: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] }])).toBe('');
  });

  it('joins multiple text blocks in the last assistant message with newlines', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        seq: 1,
        content: [
          { type: 'text', text: 'part one' },
          { type: 'tool_use', id: 't1', name: 'read', input: {} },
          { type: 'text', text: 'part two' },
        ],
      },
    ];
    expect(extractFinalText(messages)).toBe('part one\npart two');
  });
});

describe('parseDotEnvContent', () => {
  it('parses simple KEY=value lines', () => {
    expect(parseDotEnvContent('OPENAI_API_KEY=sk-abc\nUAGENT_MODEL=deepseek-v4-flash')).toEqual({
      OPENAI_API_KEY: 'sk-abc',
      UAGENT_MODEL: 'deepseek-v4-flash',
    });
  });

  it('ignores blank lines and # comments', () => {
    expect(parseDotEnvContent('# comment\n\nOPENAI_API_KEY=sk-abc\n  # another comment')).toEqual({
      OPENAI_API_KEY: 'sk-abc',
    });
  });

  it('skips keys with an empty value -- "leave blank to use default" semantics', () => {
    expect(parseDotEnvContent('ANTHROPIC_BASE_URL=\nOPENAI_API_KEY=sk-abc')).toEqual({
      OPENAI_API_KEY: 'sk-abc',
    });
  });

  it('strips one layer of matching surrounding quotes', () => {
    expect(parseDotEnvContent('A="quoted value"\nB=\'single quoted\'')).toEqual({
      A: 'quoted value',
      B: 'single quoted',
    });
  });

  it('does not choke on values that themselves contain "="', () => {
    expect(parseDotEnvContent('OPENAI_BASE_URL=https://api.deepseek.com?x=1')).toEqual({
      OPENAI_BASE_URL: 'https://api.deepseek.com?x=1',
    });
  });
});

describe('formatUsage', () => {
  it('formats all four usage fields', () => {
    const result = formatUsage({
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 950,
    });
    expect(result).toContain('input_tokens=100');
    expect(result).toContain('cache_read_input_tokens=950');
  });

  it('handles undefined usage gracefully', () => {
    expect(formatUsage(undefined)).toBe('(no usage info)');
  });
});
