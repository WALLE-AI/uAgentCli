import type { IndexStore } from './types.js';

/** 最简单的内存索引：`scanIncremental()` 本身也只用内存 `lastSeenHash`，持久化级别保持一致。 */
export class InMemoryIndexStore implements IndexStore {
  private readonly chunksByCandidateId = new Map<string, string[]>();

  upsert(candidateId: string, chunks: string[]): void {
    this.chunksByCandidateId.set(candidateId, chunks);
  }

  get(candidateId: string): string[] | undefined {
    return this.chunksByCandidateId.get(candidateId);
  }
}
