import { describe, expect, it } from 'vitest';
import { KnowledgePipeline } from '../../src/knowledge/pipeline.js';
import { InMemoryIndexStore } from '../../src/knowledge/index-store.js';
import type { KnowledgeCandidate } from '../../src/knowledge/types.js';

function candidate(id: string, hash: string): KnowledgeCandidate {
  return { id, path: `/docs/${id}.md`, hash, content: `content of ${id}` };
}

describe('KnowledgePipeline.scanIncremental (real incremental-scan logic)', () => {
  it('treats a never-before-seen candidate as changed', async () => {
    const pipeline = new KnowledgePipeline({
      source: { id: 'fs', scan: async () => [candidate('a', 'h1')] },
      changeDetector: { hasChanged: (_c, prev) => prev === undefined },
      admission: { admit: () => true },
      extractor: { extract: async () => [] },
      index: new InMemoryIndexStore(),
    });

    expect(await pipeline.scanIncremental()).toEqual([candidate('a', 'h1')]);
  });

  it('does not re-report a candidate whose hash is unchanged on a later scan', async () => {
    let hash = 'h1';
    const pipeline = new KnowledgePipeline({
      source: { id: 'fs', scan: async () => [candidate('a', hash)] },
      changeDetector: { hasChanged: (c, prev) => prev !== c.hash },
      admission: { admit: () => true },
      extractor: { extract: async () => [] },
      index: new InMemoryIndexStore(),
    });

    expect(await pipeline.scanIncremental()).toHaveLength(1);
    expect(await pipeline.scanIncremental()).toHaveLength(0);

    hash = 'h2';
    expect(await pipeline.scanIncremental()).toHaveLength(1);
  });

  it('filters out changed candidates rejected by the admission policy', async () => {
    const pipeline = new KnowledgePipeline({
      source: { id: 'fs', scan: async () => [candidate('a', 'h1'), candidate('b', 'h1')] },
      changeDetector: { hasChanged: (_c, prev) => prev === undefined },
      admission: { admit: (c) => c.id === 'a' },
      extractor: { extract: async () => [] },
      index: new InMemoryIndexStore(),
    });

    const result = await pipeline.scanIncremental();
    expect(result.map((c) => c.id)).toEqual(['a']);
  });
});

describe('KnowledgePipeline.runOnce (extraction + indexing)', () => {
  it('extracts and indexes every admitted candidate from this round', async () => {
    const index = new InMemoryIndexStore();
    const pipeline = new KnowledgePipeline({
      source: { id: 'fs', scan: async () => [candidate('a', 'h1'), candidate('b', 'h1')] },
      changeDetector: { hasChanged: (_c, prev) => prev === undefined },
      admission: { admit: () => true },
      extractor: { extract: async (c) => [`chunk-of-${c.id}`] },
      index,
    });

    const result = await pipeline.runOnce();
    expect(result.indexed.sort()).toEqual(['a', 'b']);
    expect(index.get('a')).toEqual(['chunk-of-a']);
    expect(index.get('b')).toEqual(['chunk-of-b']);
  });

  it('does not re-extract a candidate whose hash is unchanged on a later run', async () => {
    let hash = 'h1';
    let extractCalls = 0;
    const index = new InMemoryIndexStore();
    const pipeline = new KnowledgePipeline({
      source: { id: 'fs', scan: async () => [candidate('a', hash)] },
      changeDetector: { hasChanged: (c, prev) => prev !== c.hash },
      admission: { admit: () => true },
      extractor: {
        extract: async (c) => {
          extractCalls += 1;
          return [`chunk-of-${c.id}-${hash}`];
        },
      },
      index,
    });

    expect((await pipeline.runOnce()).indexed).toEqual(['a']);
    expect((await pipeline.runOnce()).indexed).toEqual([]);
    expect(extractCalls).toBe(1);

    hash = 'h2';
    expect((await pipeline.runOnce()).indexed).toEqual(['a']);
    expect(extractCalls).toBe(2);
    expect(index.get('a')).toEqual(['chunk-of-a-h2']);
  });

  it('skips extraction entirely when nothing is admitted', async () => {
    let extractCalls = 0;
    const index = new InMemoryIndexStore();
    const pipeline = new KnowledgePipeline({
      source: { id: 'fs', scan: async () => [] },
      changeDetector: { hasChanged: () => false },
      admission: { admit: () => true },
      extractor: {
        extract: async () => {
          extractCalls += 1;
          return [];
        },
      },
      index,
    });

    expect(await pipeline.runOnce()).toEqual({ indexed: [] });
    expect(extractCalls).toBe(0);
  });
});
