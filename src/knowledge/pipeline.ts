import type { AdmissionPolicy, ChangeDetector, DataSource, Extractor, IndexStore, KnowledgeCandidate } from './types.js';

export interface KnowledgePipelineDeps {
  source: DataSource;
  changeDetector: ChangeDetector;
  admission: AdmissionPolicy;
  extractor: Extractor;
  index: IndexStore;
}

export interface RunOnceResult {
  /** 本轮被抽取并写入索引的 candidate id 列表。 */
  indexed: string[];
}

/**
 * 增量扫描 + 抽取索引管线：`scanIncremental()` 发现变化候选并做准入过滤；
 * `runOnce()` 在此基础上对每个准入候选跑抽取，把结果写入 `IndexStore`。
 */
export class KnowledgePipeline {
  private readonly lastSeenHash = new Map<string, string>();

  constructor(private readonly deps: KnowledgePipelineDeps) {}

  async scanIncremental(): Promise<KnowledgeCandidate[]> {
    const candidates = await this.deps.source.scan();
    const changed = candidates.filter((candidate) =>
      this.deps.changeDetector.hasChanged(candidate, this.lastSeenHash.get(candidate.id)),
    );
    const admitted = changed.filter((candidate) => this.deps.admission.admit(candidate));
    for (const candidate of admitted) {
      this.lastSeenHash.set(candidate.id, candidate.hash);
    }
    return admitted;
  }

  /** 扫描本轮变化候选 → 逐个抽取 → 写入索引。返回被索引的 candidate id 列表。 */
  async runOnce(): Promise<RunOnceResult> {
    const admitted = await this.scanIncremental();
    const indexed: string[] = [];
    for (const candidate of admitted) {
      const chunks = await this.deps.extractor.extract(candidate);
      this.deps.index.upsert(candidate.id, chunks);
      indexed.push(candidate.id);
    }
    return { indexed };
  }
}
