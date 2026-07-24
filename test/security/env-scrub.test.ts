import { describe, expect, it } from 'vitest';
import { scrubEnv } from '../../src/security/env-scrub.js';

describe('scrubEnv', () => {
  it('strips known secret variable name patterns', () => {
    const input = {
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      OPENAI_API_KEY: 'sk-oai-xxx',
      DEEPSEEK_API_KEY: 'dpk-xxx',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      AWS_SESSION_TOKEN: 'aws-session',
      DB_PASSWORD: 'hunter2',
      GITHUB_TOKEN: 'ghp_xxx',
      SOME_CREDENTIALS: 'blob',
    };
    const scrubbed = scrubEnv(input);
    expect(Object.keys(scrubbed)).toEqual([]);
  });

  it('keeps non-secret variables untouched', () => {
    const input = { PATH: '/usr/bin', NODE_ENV: 'test', UAGENT_HOME: '/home/user/.uagent' };
    const scrubbed = scrubEnv(input);
    expect(scrubbed).toEqual(input);
  });

  it('returns a copy: the original object passed in is not mutated', () => {
    const input: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk-ant-xxx', PATH: '/usr/bin' };
    const original = { ...input };
    scrubEnv(input);
    expect(input).toEqual(original);
  });

  it('mixes secret and non-secret vars correctly', () => {
    const input = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-xxx', HOME: '/home/user' };
    const scrubbed = scrubEnv(input);
    expect(scrubbed).toEqual({ PATH: '/usr/bin', HOME: '/home/user' });
  });
});
