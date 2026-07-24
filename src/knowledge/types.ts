/**
 * §J 骨架模块：知识库各阶段接口。"增量扫描发现变化候选"（`scanIncremental`）
 * 和"抽取 + 索引写入"（`runOnce`，依赖 `IndexStore`）都已钉死形状与实现。
 */
export interface KnowledgeCandidate {
  id: string;
  path: string;
  hash: string;
  content: string;
}

export interface DataSource {
  id: string;
  scan(): Promise<KnowledgeCandidate[]>;
}

export interface ChangeDetector {
  /** `previousHash` 为 undefined 时视为"首次见到"，一律判定为已变化。 */
  hasChanged(candidate: KnowledgeCandidate, previousHash: string | undefined): boolean;
}

export interface AdmissionPolicy {
  admit(candidate: KnowledgeCandidate): boolean;
}

export interface Extractor {
  extract(candidate: KnowledgeCandidate): Promise<string[]>;
}

/** 抽取结果的落地存储：按 candidate id 存一组文本块（chunks）。 */
export interface IndexStore {
  upsert(candidateId: string, chunks: string[]): void;
  get(candidateId: string): string[] | undefined;
}
