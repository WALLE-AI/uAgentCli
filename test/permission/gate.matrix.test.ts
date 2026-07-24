import { describe, expect, it, beforeAll } from 'vitest';
import type { Ruleset } from '../../src/permission/types.js';
import type { PermissionMode } from '../../src/permission/mode.js';
import type { GateInput } from '../../src/permission/gate.js';
import { freshImport } from '../helpers/fresh-import.js';

type GateModule = typeof import('../../src/permission/gate.js');

// Force bypass/yolo enabled via a freshly-loaded module instance so the
// matrix can actually exercise step 7 for bypass/yolo modes.
let checkToolPermission: (input: GateInput) => 'allow' | 'deny' | 'ask';

beforeAll(async () => {
  process.env.UAGENT_YOLO_ENABLED = 'true';
  process.env.UAGENT_BYPASS_ENABLED = 'true';
  const mod = await freshImport<GateModule>('../../src/permission/gate.js?case=matrix');
  checkToolPermission = mod.checkToolPermission;
});

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypass', 'yolo'];

const EMPTY: Ruleset = { rules: [] };

function baseInput(mode: PermissionMode, overrides: Partial<GateInput> = {}): GateInput {
  return {
    action: 'write',
    pattern: 'file.txt',
    mode,
    ruleset: EMPTY,
    approved: EMPTY,
    ...overrides,
  };
}

describe('checkToolPermission bypass-immune matrix (steps 1-6 block under every mode)', () => {
  it.each(MODES)('hardline command is denied under mode=%s', (mode) => {
    const result = checkToolPermission(baseInput(mode, { hardline: true }));
    expect(result).toBe('deny');
  });

  it.each(MODES)('explicit deny rule wins under mode=%s', (mode) => {
    const ruleset: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'deny' }] };
    const result = checkToolPermission(baseInput(mode, { ruleset }));
    expect(result).toBe('deny');
  });

  it.each(MODES)('explicit ask rule is not bypassed under mode=%s', (mode) => {
    const ruleset: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'ask' }] };
    const result = checkToolPermission(baseInput(mode, { ruleset }));
    expect(mode === 'dontAsk' ? 'deny' : 'ask').toBe(result);
  });

  it.each(MODES)('tool self-judgment deny/ask is not bypassed under mode=%s', (mode) => {
    const result = checkToolPermission(baseInput(mode, { toolCheck: () => 'deny' }));
    expect(result).toBe('deny');
  });

  it.each(MODES)('requiresUserInteraction still asks under mode=%s', (mode) => {
    const result = checkToolPermission(baseInput(mode, { requiresUserInteraction: true }));
    expect(mode === 'dontAsk' ? 'deny' : 'ask').toBe(result);
  });

  it.each(MODES)('content-level ask (e.g. boundary/.env) is not bypassed under mode=%s', (mode) => {
    const result = checkToolPermission(baseInput(mode, { contentAsk: true }));
    expect(mode === 'dontAsk' ? 'deny' : 'ask').toBe(result);
  });

  it.each(MODES)('safetyCheck is not bypassed under mode=%s', (mode) => {
    const result = checkToolPermission(baseInput(mode, { safetyCheck: true }));
    expect(mode === 'dontAsk' ? 'deny' : 'ask').toBe(result);
  });
});

describe('checkToolPermission step 7+ (mode-dependent behavior, only reached once 1-6 clear)', () => {
  it('bypass mode allows once nothing in steps 1-6 objects', () => {
    const result = checkToolPermission(baseInput('bypass'));
    expect(result).toBe('allow');
  });

  it('yolo mode allows once nothing in steps 1-6 objects', () => {
    const result = checkToolPermission(baseInput('yolo'));
    expect(result).toBe('allow');
  });

  it('default mode with nothing flagged falls through to the default ask', () => {
    const result = checkToolPermission(baseInput('default'));
    expect(result).toBe('ask');
  });

  it('dontAsk downgrades the final default ask to deny', () => {
    const result = checkToolPermission(baseInput('dontAsk'));
    expect(result).toBe('deny');
  });

  it('an explicit allow rule is honored at the default step when nothing else objects', () => {
    const ruleset: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'allow' }] };
    expect(checkToolPermission(baseInput('default', { ruleset }))).toBe('allow');
  });

  it('alwaysAllow (step 8) grants allow even in default mode', () => {
    const approved: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'allow' }] };
    expect(checkToolPermission(baseInput('default', { approved }))).toBe('allow');
  });
});
