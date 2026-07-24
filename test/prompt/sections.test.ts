import { afterEach, describe, expect, it } from 'vitest';
import { advance, freeze, unfreeze } from '../helpers/clock.js';
import { expectGolden } from '../helpers/golden.js';
import { identitySection } from '../../src/prompt/sections/identity.js';
import { toolPolicySection } from '../../src/prompt/sections/tool-policy.js';
import { environmentSection } from '../../src/prompt/sections/environment.js';
import { memorySnapshotSection } from '../../src/prompt/sections/memory-snapshot.js';
import { skillsVerboseSection } from '../../src/prompt/sections/skills-verbose.js';

describe('prompt sections', () => {
  afterEach(() => {
    unfreeze();
  });

  it('each section computes independently without shared state', () => {
    expect(identitySection.compute()).toContain('uAgentCli');
    expect(toolPolicySection.compute()).toContain('工具使用策略');
    expect(memorySnapshotSection.compute()).toContain('<memory>');
    expect(skillsVerboseSection.compute()).toContain('<skills>');
  });

  it('environment section date stays byte-stable across hour/minute advances within the same day', () => {
    freeze('2026-07-22T00:00:01.000Z');
    const first = environmentSection.compute();

    advance(3 * 60 * 60 * 1000 + 45 * 60 * 1000); // +3h45m, still same UTC day
    const second = environmentSection.compute();

    expect(second).toBe(first);
  });

  it('environment section changes only the date line when the day rolls over', () => {
    freeze('2026-07-22T23:59:00.000Z');
    const beforeMidnight = environmentSection.compute();

    advance(2 * 60 * 1000); // crosses into 07-23
    const afterMidnight = environmentSection.compute();

    expect(afterMidnight).not.toBe(beforeMidnight);
    expect(beforeMidnight).toContain('date: 2026-07-22');
    expect(afterMidnight).toContain('date: 2026-07-23');
  });

  it('environment section output is golden-stable for a fixed cwd/platform/date', () => {
    freeze('2026-07-22T12:00:00.000Z');
    expectGolden('prompt-environment-section', environmentSection.compute());
  });
});
