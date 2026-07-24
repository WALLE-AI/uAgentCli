import { afterEach, describe, expect, it } from 'vitest';
import { freeze, unfreeze } from '../helpers/clock.js';
import { expectGolden } from '../helpers/golden.js';
import { buildSystemPrompt, selectModelVariant } from '../../src/prompt/system-prompt.js';

describe('buildSystemPrompt', () => {
  afterEach(() => {
    unfreeze();
  });

  it('is idempotent: identical input produces byte-identical output', () => {
    freeze('2026-07-22T12:00:00.000Z');
    const input = { model: { id: 'claude-sonnet-5' } };
    const a = buildSystemPrompt(input);
    const b = buildSystemPrompt(input);
    expect(a).toBe(b);
  });

  it('selects anthropic template for claude model ids', () => {
    expect(selectModelVariant('claude-sonnet-5')).toBe('anthropic');
    expect(selectModelVariant('anthropic/claude-3-5-sonnet')).toBe('anthropic');
  });

  it('selects openai template for the whole OpenAI-compatible family', () => {
    expect(selectModelVariant('gpt-4o')).toBe('openai');
    expect(selectModelVariant('deepseek-chat')).toBe('openai');
    expect(selectModelVariant('qwen-max')).toBe('openai');
    expect(selectModelVariant('openrouter/some-model')).toBe('openai');
  });

  it('falls back to default template for unknown model ids', () => {
    expect(selectModelVariant('some-local-model')).toBe('default');
  });

  it('priority: override > agentPrompt > customTemplate > default', () => {
    freeze('2026-07-22T12:00:00.000Z');
    const base = { model: { id: 'claude-sonnet-5' } };

    const withDefault = buildSystemPrompt(base);
    const withCustom = buildSystemPrompt({ ...base, customTemplate: 'CUSTOM_TEMPLATE' });
    const withAgent = buildSystemPrompt({
      ...base,
      customTemplate: 'CUSTOM_TEMPLATE',
      agentPrompt: 'AGENT_PROMPT',
    });
    const withOverride = buildSystemPrompt({
      ...base,
      customTemplate: 'CUSTOM_TEMPLATE',
      agentPrompt: 'AGENT_PROMPT',
      override: 'OVERRIDE_TEXT',
    });

    expect(withDefault.startsWith('You are uAgentCli')).toBe(true);
    expect(withCustom.startsWith('CUSTOM_TEMPLATE')).toBe(true);
    expect(withAgent.startsWith('AGENT_PROMPT')).toBe(true);
    expect(withOverride.startsWith('OVERRIDE_TEXT')).toBe(true);
  });

  it('golden: full assembled prompt is byte-stable for fixed inputs', () => {
    freeze('2026-07-22T12:00:00.000Z');
    const output = buildSystemPrompt({ model: { id: 'claude-sonnet-5' } });
    expectGolden('system-prompt-anthropic-default', output);
  });
});
