export interface MemoryEntry {
  id: string;
  agentName: string;
  content: string;
  createdAt: number;
}

export interface WriteMemoryInput {
  id?: string;
  agentName: string;
  content: string;
  createdAt?: number;
}

export interface RetrievedMemoryEntry extends MemoryEntry {
  /** threat-scan 命中——`content` 已被替换为 `[BLOCKED]` 降级文本。 */
  blocked: boolean;
}

export interface MemoryStore {
  write(input: WriteMemoryInput): MemoryEntry;
  /** 结果逐条过 threat-scan 后返回，按 `agentName` 命名空间隔离。 */
  retrieve(agentName: string, topK: number, query?: string): RetrievedMemoryEntry[];
  forget(id: string): void;
}
