import { randomUUID } from 'node:crypto';
import { threatScan } from '../security/threat-scan.js';
import type { MemoryEntry, MemoryStore, RetrievedMemoryEntry, WriteMemoryInput } from './types.js';

/**
 * 当前会话临时记忆：进程内 Map，重启即丢——用于会话范围内的短期记忆，
 * 不落盘。同样按 `agentName` 命名空间隔离，retrieve 结果同样过 threat-scan。
 */
export class SessionMemory implements MemoryStore {
  private readonly entries = new Map<string, MemoryEntry>();

  write(input: WriteMemoryInput): MemoryEntry {
    const record: MemoryEntry = {
      id: input.id ?? randomUUID(),
      agentName: input.agentName,
      content: input.content,
      createdAt: input.createdAt ?? Date.now(),
    };
    this.entries.set(record.id, record);
    return record;
  }

  forget(id: string): void {
    this.entries.delete(id);
  }

  retrieve(agentName: string, topK: number): RetrievedMemoryEntry[] {
    const matches = [...this.entries.values()]
      .filter((entry) => entry.agentName === agentName)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, topK);

    return matches.map((entry) => {
      const scan = threatScan(entry.content);
      return { ...entry, content: scan.clean, blocked: scan.verdict === 'blocked' };
    });
  }
}
