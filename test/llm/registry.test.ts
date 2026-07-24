import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../../src/llm/registry.js';
import { createMockProvider } from '../../src/llm/mock-provider.js';

describe('createProviderRegistry', () => {
  it('routes claude/anthropic model ids to the anthropic provider', () => {
    const anthropic = createMockProvider([]);
    const registry = createProviderRegistry({ anthropic });
    expect(registry.getProvider('claude-sonnet-5')).toBe(anthropic);
  });

  it('routes the whole OpenAI-compatible family to the openai provider', () => {
    const openai = createMockProvider([]);
    const registry = createProviderRegistry({ openai });
    expect(registry.getProvider('gpt-4o')).toBe(openai);
    expect(registry.getProvider('deepseek-chat')).toBe(openai);
  });

  it('throws a clear error for an unregistered provider family instead of silently falling back', () => {
    const registry = createProviderRegistry({ anthropic: createMockProvider([]) });
    expect(() => registry.getProvider('gpt-4o')).toThrow(/openai/);
  });
});
