import { describe, expect, it } from 'vitest';
import { redact } from '../../src/security/redact.js';
import { freshImport } from '../helpers/fresh-import.js';

type RedactModule = typeof import('../../src/security/redact.js');

describe('redact', () => {
  it('redacts an Anthropic-style API key', () => {
    const result = redact('key is sk-ant-api03-abcdefghijklmnop');
    expect(result).not.toContain('sk-ant-api03-abcdefghijklmnop');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts a generic sk- prefixed key', () => {
    const result = redact('token=sk-abcdefghijklmnopqrstuvwx');
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('redacts Bearer tokens', () => {
    const result = redact('Authorization: Bearer abc123def456ghi789');
    expect(result).not.toContain('abc123def456ghi789');
    expect(result).toContain('Bearer [REDACTED]');
  });

  it('redacts KEY=value / TOKEN: value style assignments', () => {
    const result = redact('DB_PASSWORD=supersecret123 API_KEY: myapikeyvalue');
    expect(result).not.toContain('supersecret123');
    expect(result).not.toContain('myapikeyvalue');
  });

  it('redacts a password embedded in a DB connection URL', () => {
    const result = redact('postgres://user:hunter2pass@db.internal:5432/app');
    expect(result).not.toContain('hunter2pass');
    expect(result).toContain('postgres://user:[REDACTED]@db.internal:5432/app');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'This is a normal log line with no secrets in it.';
    expect(redact(text)).toBe(text);
  });
});

describe('M0.6 redact 厂商正则 + 熵兜底', () => {
  it('AWS AKIA / GitHub ghp_ / JWT / PEM', () => {
    expect(redact('id AKIAIOSFODNN7EXAMPLE here')).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redact('ghp_' + 'a'.repeat(36))).not.toContain('ghp_aaaa');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123DEFxyz';
    expect(redact(`tok ${jwt}`)).not.toContain(jwt);
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toContain('[REDACTED_PRIVATE_KEY]');
  });

  it('Shannon 熵兜底：未知格式高熵 token 被脱敏', () => {
    const secret = 'Zx9Qk2Lp7Vn4Rm8Ty6Wb3Fc5Hd1Jg0'; // 31 chars, 含字母数字, 高熵
    const out = redact(`value: ${secret}`);
    expect(out).toContain('[REDACTED_HIGH_ENTROPY_TOKEN]');
    expect(out).not.toContain(secret);
  });

  it('protected span 豁免：URL / 长路径不被熵误伤', () => {
    const url = 'https://example.com/path/aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(redact(url)).toBe(url);
    const path = '/usr/local/share/some-long-directory-name-aaaaaaaa/file';
    expect(redact(path)).toBe(path);
  });

  it('低熵长串（重复字符）不误报', () => {
    const text = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 低熵，无数字
    expect(redact(text)).toBe(text);
  });
});

describe('redact enable flag is frozen at module load', () => {
  it('is enabled by default', async () => {
    delete process.env.UAGENT_REDACT_DISABLED;
    const mod = await freshImport<RedactModule>('../../src/security/redact.js?case=default');
    expect(mod.isRedactEnabled()).toBe(true);
  });

  it('can only be disabled via a startup-time env value, and mutating it later has no effect', async () => {
    process.env.UAGENT_REDACT_DISABLED = 'true';
    const disabledAtStartup = await freshImport<RedactModule>('../../src/security/redact.js?case=disabled');
    expect(disabledAtStartup.isRedactEnabled()).toBe(false);
    expect(disabledAtStartup.redact('sk-ant-api03-abcdefghijklmnop')).toContain('sk-ant-api03-abcdefghijklmnop');

    // Runtime mutation after load must not re-enable it.
    delete process.env.UAGENT_REDACT_DISABLED;
    expect(disabledAtStartup.isRedactEnabled()).toBe(false);
  });

  it('a later module instance is unaffected by an earlier instance being disabled', async () => {
    delete process.env.UAGENT_REDACT_DISABLED;
    const mod = await freshImport<RedactModule>('../../src/security/redact.js?case=reenabled');
    expect(mod.isRedactEnabled()).toBe(true);
  });
});
