import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import { threatScan } from '../security/threat-scan.js';
import type { MemoryEntry, MemoryStore, RetrievedMemoryEntry, WriteMemoryInput } from './types.js';

interface MemoryRow {
  id: string;
  agent_name: string;
  content: string;
  created_at: number;
}

/**
 * 朴素词袋打分：不接真实 embedding API（标注升级点）。无 query 时按
 * createdAt 倒序（最近优先）；有 query 时按词重叠数排序，`Array.sort`
 * 稳定排序保证同分时仍按 createdAt 倒序作为次级排序。
 */
function bagOfWordsScore(query: string, content: string): number {
  const queryWords = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  if (queryWords.size === 0) {
    return 0;
  }
  const contentWords = content.toLowerCase().split(/\W+/).filter(Boolean);
  let score = 0;
  for (const word of contentWords) {
    if (queryWords.has(word)) {
      score += 1;
    }
  }
  return score;
}

export class LongTermMemoryStore implements MemoryStore {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agent_name);
    `);
  }

  write(input: WriteMemoryInput): MemoryEntry {
    const record: MemoryEntry = {
      id: input.id ?? randomUUID(),
      agentName: input.agentName,
      content: input.content,
      createdAt: input.createdAt ?? Date.now(),
    };
    this.db
      .prepare('INSERT INTO memory (id, agent_name, content, created_at) VALUES (?, ?, ?, ?)')
      .run(record.id, record.agentName, record.content, record.createdAt);
    return record;
  }

  forget(id: string): void {
    this.db.prepare('DELETE FROM memory WHERE id = ?').run(id);
  }

  retrieve(agentName: string, topK: number, query = ''): RetrievedMemoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memory WHERE agent_name = ? ORDER BY created_at DESC')
      .all(agentName) as MemoryRow[];

    const scored = rows
      .map((row) => ({ row, score: bagOfWordsScore(query, row.content) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map(({ row }) => {
      const scan = threatScan(row.content);
      return {
        id: row.id,
        agentName: row.agent_name,
        content: scan.clean,
        createdAt: row.created_at,
        blocked: scan.verdict === 'blocked',
      };
    });
  }
}
