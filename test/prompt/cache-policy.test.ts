import { describe, expect, it } from 'vitest';
import type { PromptSection } from '../../src/prompt/types.js';
import { resolveCacheBreakpoints } from '../../src/prompt/cache-policy.js';

function section(name: string, cacheable: boolean): PromptSection {
  return { name, tier: cacheable ? 'stable' : 'volatile', cacheable, compute: () => name };
}

describe('resolveCacheBreakpoints', () => {
  it('places a breakpoint at the end of the leading cacheable run', () => {
    const sections = [section('identity', true), section('tool-policy', true), section('env', false)];
    expect(resolveCacheBreakpoints(sections)).toEqual([1]);
  });

  it('places no breakpoint when the first section is not cacheable', () => {
    const sections = [section('env', false), section('identity', true)];
    expect(resolveCacheBreakpoints(sections)).toEqual([]);
  });

  it('places a breakpoint at the last index when every section is cacheable', () => {
    const sections = [section('identity', true), section('tool-policy', true)];
    expect(resolveCacheBreakpoints(sections)).toEqual([1]);
  });

  it('returns an empty array for an empty section list', () => {
    expect(resolveCacheBreakpoints([])).toEqual([]);
  });

  it('does not resume counting cacheable sections after a volatile gap', () => {
    const sections = [section('identity', true), section('env', false), section('memory', false)];
    expect(resolveCacheBreakpoints(sections)).toEqual([0]);
  });
});
