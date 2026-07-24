import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freeze, unfreeze } from '../helpers/clock.js';
import { expectGolden } from '../helpers/golden.js';
import { createFakeFs } from '../helpers/fs.js';
import { assembleContext, resolveProjectDoc, type AssembleContextInput } from '../../src/context/pipeline.js';

function baseInput(overrides: Partial<AssembleContextInput> = {}): AssembleContextInput {
  return {
    model: { id: 'claude-sonnet-5' },
    soulText: '# SOUL\nBe careful and transparent.',
    projectDocText: '# Project\nThis is a demo repo.',
    skillsVerboseText: '<available_skills>\n  <skill><name>x</name></skill>\n</available_skills>',
    envText: '<env>\ncwd: /repo\n</env>',
    memorySnapshotText: '<memory>\n(no entries)\n</memory>',
    historyText: 'User: hello\nAssistant: hi there',
    ...overrides,
  };
}

describe('assembleContext', () => {
  beforeEach(() => {
    freeze('2026-07-22T00:00:00Z');
  });

  afterEach(() => {
    unfreeze();
  });

  it('is idempotent: identical input produces byte-identical output', () => {
    const input = baseInput();
    expect(assembleContext(input)).toBe(assembleContext(input));
  });

  it('assembles sections in the fixed order: stable prompt -> soul -> project doc+skills -> mcp -> env -> memory -> history', () => {
    const output = assembleContext(baseInput());
    // buildSystemPrompt's stable output (iteration1) already bakes in its own
    // placeholder <env>/<memory> sections; pipeline.ts appends the *real*
    // env/memory blocks after that, so we look at the LAST occurrence to
    // find pipeline's own section, not buildSystemPrompt's internal one.
    const soulIdx = output.indexOf('Be careful and transparent');
    const docIdx = output.indexOf('demo repo');
    const skillsIdx = output.indexOf('available_skills');
    const envIdx = output.lastIndexOf('<env>');
    const memoryIdx = output.lastIndexOf('<memory>');
    const historyIdx = output.indexOf('User: hello');

    expect(soulIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeGreaterThan(soulIdx);
    expect(skillsIdx).toBeGreaterThan(docIdx);
    expect(envIdx).toBeGreaterThan(skillsIdx);
    expect(memoryIdx).toBeGreaterThan(envIdx);
    expect(historyIdx).toBeGreaterThan(memoryIdx);
  });

  it('omits empty optional blocks (e.g. empty project doc) without leaving stray separators', () => {
    const output = assembleContext(baseInput({ projectDocText: '' }));
    expect(output).not.toContain('\n\n\n\n');
  });

  it('golden: full assembled context is byte-stable for fixed inputs', () => {
    expectGolden('pipeline-assemble-context', assembleContext(baseInput()));
  });
});

describe('resolveProjectDoc', () => {
  it('returns empty string when omitProjectDoc is set', () => {
    const { fsLike } = createFakeFs({ '/repo/AGENT.md': 'doc content' });
    expect(resolveProjectDoc('/repo', { omitProjectDoc: true, fsImpl: fsLike })).toBe('');
  });

  it('returns the found AGENT.md content (via identity-files walk-up)', () => {
    const { fsLike } = createFakeFs({ '/repo/AGENT.md': 'doc content' });
    expect(resolveProjectDoc('/repo', { fsImpl: fsLike })).toBe('doc content');
  });

  it('returns empty string when no doc is found', () => {
    const { fsLike } = createFakeFs({ '/repo/.git/HEAD': 'ref: refs/heads/main' });
    expect(resolveProjectDoc('/repo', { fsImpl: fsLike })).toBe('');
  });
});
