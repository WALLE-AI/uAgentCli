import { describe, expect, it } from 'vitest';
import { resolveBypassDecision } from '../../src/permission/mode.js';
import { freshImport } from '../helpers/fresh-import.js';

type ModeModule = typeof import('../../src/permission/mode.js');

describe('bypass/yolo enable flags are frozen at module load', () => {
  it('a fresh module instance snapshots the env at import time; later mutation of that same instance has no effect', async () => {
    process.env.UAGENT_YOLO_ENABLED = 'true';
    const first = await freshImport<ModeModule>('../../src/permission/mode.js?case=freeze-1');
    expect(first.isBypassModeEnabled('yolo')).toBe(true);

    // Mutate env after the module has already loaded and snapshotted it.
    process.env.UAGENT_YOLO_ENABLED = 'false';
    expect(first.isBypassModeEnabled('yolo')).toBe(true);
  });

  it('a distinct module instance loaded later captures whatever env value is current at ITS load time', async () => {
    process.env.UAGENT_YOLO_ENABLED = 'false';
    const second = await freshImport<ModeModule>('../../src/permission/mode.js?case=freeze-2');
    expect(second.isBypassModeEnabled('yolo')).toBe(false);

    process.env.UAGENT_YOLO_ENABLED = 'true';
    expect(second.isBypassModeEnabled('yolo')).toBe(false);
  });

  it('non-bypass/yolo modes are never enabled regardless of env', async () => {
    process.env.UAGENT_YOLO_ENABLED = 'true';
    process.env.UAGENT_BYPASS_ENABLED = 'true';
    const mod = await freshImport<ModeModule>('../../src/permission/mode.js?case=freeze-3');
    expect(mod.isBypassModeEnabled('default')).toBe(false);
    expect(mod.isBypassModeEnabled('acceptEdits')).toBe(false);
    expect(mod.isBypassModeEnabled('plan')).toBe(false);
    expect(mod.isBypassModeEnabled('dontAsk')).toBe(false);
  });
});

describe('resolveBypassDecision', () => {
  it('returns ask when the mode is not bypass/yolo, regardless of classifier', () => {
    expect(resolveBypassDecision('default', () => true)).toBe('ask');
  });

  it('degrades to ask (fail-closed) when the classifier is unavailable or returns undefined', async () => {
    process.env.UAGENT_YOLO_ENABLED = 'true';
    const mod = await freshImport<ModeModule>('../../src/permission/mode.js?case=classifier-1');
    expect(mod.resolveBypassDecision('yolo', () => undefined)).toBe('ask');
  });

  it('allows without a classifier when the mode is enabled', async () => {
    process.env.UAGENT_YOLO_ENABLED = 'true';
    const mod = await freshImport<ModeModule>('../../src/permission/mode.js?case=classifier-2');
    expect(mod.resolveBypassDecision('yolo')).toBe('allow');
  });

  it('respects an available classifier that returns true/false', async () => {
    process.env.UAGENT_YOLO_ENABLED = 'true';
    const mod = await freshImport<ModeModule>('../../src/permission/mode.js?case=classifier-3');
    expect(mod.resolveBypassDecision('yolo', () => true)).toBe('allow');
    expect(mod.resolveBypassDecision('yolo', () => false)).toBe('ask');
  });
});
