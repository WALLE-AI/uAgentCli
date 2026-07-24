/**
 * M0.5 · Prompt 分段模型（注入式，替代零参 `compute()`）。
 *
 * `buildSystemPrompt` 的历史形态是"零参 compute() 各段自取数据"，导致
 * skills/env/memory 段一边输出硬编码占位、一边被 pipeline 追加真实数据
 * → 双 `<skills>`/`<env>`/`<memory>` bug（D/T7.6）。本模型改为**接受注入数据**，
 * 每段只产出一次，并携带 `cacheable` 标志供 T7.7 放置 `cache_control`。
 *
 * 空段规则（D 节坑）：
 *  - stable/context 段即使空也输出**稳定占位**（保结构、防缓存断点漂移）；
 *  - volatile 段（env/memory/history）为空**直接跳过**（它们在断点之后）。
 *
 * 纯函数铁律：不读时钟/随机/无序遍历——所有易变输入由调用方注入字符串。
 * T7.6 负责把 skill registry / 记忆检索的真实结果喂进来。
 */

export interface SectionInput {
  /** 基础 prompt：override/agentPrompt/customTemplate/model 模板择一，最前、stable。 */
  basePrompt: string;
  /** identity-files `loadSoul()`，stable。 */
  soulText?: string;
  /** 项目文档 AGENT.md，context。 */
  projectDocText?: string;
  /** 技能 verbose 列表（真实），context。空则占位 `<skills>(none)</skills>`。 */
  skillsVerboseText?: string;
  /** MCP instructions，context。 */
  mcpText?: string;
  /** `<env>` 块，volatile，空则跳过。 */
  envText?: string;
  /** 记忆快照，volatile，空则跳过。 */
  memorySnapshotText?: string;
  /** 可见历史（含 ephemeral），volatile 末段，空则跳过。 */
  historyText?: string;
}

export interface ResolvedSection {
  id: string;
  text: string;
  /** true = 属于可缓存前缀；false = volatile，必须落在缓存断点之后。 */
  cacheable: boolean;
}

const EMPTY_SKILLS = '<skills>\n(none)\n</skills>';

/**
 * 产出有序 section 列表。顺序即装配顺序，cacheable 段全部在前、volatile 段在后
 * ——这是"volatile 必须在断点后"硬不变量的结构保证（T7.7 只需在最后一个
 * cacheable 段打断点）。
 */
export function assembleSections(input: SectionInput): ResolvedSection[] {
  const sections: ResolvedSection[] = [];

  // ── cacheable 前缀（stable + context）──
  sections.push({ id: 'base', text: input.basePrompt, cacheable: true });

  // stable：soul 即使空也占位（保断点稳定）
  sections.push({ id: 'soul', text: input.soulText && input.soulText.length > 0 ? input.soulText : '', cacheable: true });

  // context：项目文档，空则占位空串但保留槽位（stable 语义）
  sections.push({
    id: 'project-doc',
    text: input.projectDocText && input.projectDocText.length > 0 ? input.projectDocText : '',
    cacheable: true,
  });

  // context：技能，空则稳定占位 `<skills>(none)</skills>`
  sections.push({
    id: 'skills',
    text: input.skillsVerboseText && input.skillsVerboseText.length > 0 ? input.skillsVerboseText : EMPTY_SKILLS,
    cacheable: true,
  });

  // context：MCP
  sections.push({
    id: 'mcp',
    text: input.mcpText && input.mcpText.length > 0 ? input.mcpText : '',
    cacheable: true,
  });

  // ── volatile 尾部（断点之后，空则真跳过）──
  if (input.envText && input.envText.length > 0) {
    sections.push({ id: 'env', text: input.envText, cacheable: false });
  }
  if (input.memorySnapshotText && input.memorySnapshotText.length > 0) {
    sections.push({ id: 'memory', text: input.memorySnapshotText, cacheable: false });
  }
  if (input.historyText && input.historyText.length > 0) {
    sections.push({ id: 'history', text: input.historyText, cacheable: false });
  }

  return sections;
}

/** 下标：最后一个 cacheable 段——T7.7 在此打 `cache_control`。volatile 全在其后。 */
export function lastCacheableIndex(sections: ResolvedSection[]): number {
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    if (sections[i].cacheable) return i;
  }
  return -1;
}

/** 渲染为单一 system 字符串（空段的 text 为 '' 时被 join 过滤保结构不出空行）。 */
export function renderSections(sections: ResolvedSection[]): string {
  return sections
    .map((s) => s.text)
    .filter((t) => t.length > 0)
    .join('\n\n');
}

/** 可缓存前缀的字节内容（golden 不变量：只改 volatile 段不应改变它）。 */
export function cacheablePrefix(sections: ResolvedSection[]): string {
  return sections
    .filter((s) => s.cacheable)
    .map((s) => s.text)
    .join('\n\n');
}
