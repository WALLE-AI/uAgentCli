import { buildSystemPrompt } from '../prompt/system-prompt.js';
import { findAgentDoc, type IdentityFsLike } from '../storage/identity-files.js';

export interface ResolveProjectDocOptions {
  omitProjectDoc?: boolean;
  fsImpl?: IdentityFsLike;
}

/** 复用 identity-files.ts 的 AGENT.md walk-up 逻辑，不重复实现查找算法。 */
export function resolveProjectDoc(cwd: string, options: ResolveProjectDocOptions = {}): string {
  if (options.omitProjectDoc) {
    return '';
  }
  const found = findAgentDoc(cwd, options.fsImpl);
  return found ? found.scan.clean : '';
}

export interface AssembleContextInput {
  model: { id: string };
  agentPrompt?: string;
  customTemplate?: string;
  override?: string;
  /** identity-files `loadSoul()` 的结果文本（已过 threat-scan）。 */
  soulText: string;
  /** `resolveProjectDoc()` 的结果，可能为空字符串。 */
  projectDocText: string;
  /** `skill/registry.ts` `formatSkills(list, {verbose:true})` 的结果。 */
  skillsVerboseText: string;
  /** MCP instructions 占位，本迭代恒为空字符串（真正接入在后续迭代）。 */
  mcpText?: string;
  /** 当前轮次的 `<env>` 块文本。 */
  envText: string;
  /** 记忆 top-k 快照文本（已逐条过 threat-scan）。 */
  memorySnapshotText: string;
  /** 已序列化好的可见历史文本。ephemeral 内容只应出现在这里，不应混进以上任何层。 */
  historyText: string;
}

/**
 * §四 固定装配顺序：身份(SOUL+stable prompt) → 项目文档+技能verbose(context)
 * → MCP(context, 本迭代占位) → env(volatile) → 记忆快照(volatile) → 历史。
 * 纯函数：相同输入产出字节相同输出，供 golden 单测钉死顺序与格式。
 *
 * 已知的迭代内简化：`buildSystemPrompt()`（迭代1）自带的 stable 输出里
 * 已经内置了占位版 `<env>`/`<memory>` 段（固定"无技能/无记忆"文本），
 * 本函数在其后再追加真实的 env/技能/记忆内容——即输出里 `<env>`/`<memory>`
 * 标签各出现两次，前一次是 iteration1 的静态占位、后一次才是真实数据。
 * 这是刻意保留 `buildSystemPrompt` 签名不变的权宜之计，真正的单一职责
 * section 列表重构留给后续迭代。
 */
export function assembleContext(input: AssembleContextInput): string {
  const stablePrompt = buildSystemPrompt({
    model: input.model,
    agentPrompt: input.agentPrompt,
    customTemplate: input.customTemplate,
    override: input.override,
  });

  const blocks = [
    stablePrompt,
    input.soulText,
    [input.projectDocText, input.skillsVerboseText].filter(Boolean).join('\n\n'),
    input.mcpText ?? '',
    input.envText,
    input.memorySnapshotText,
    input.historyText,
  ].filter((block) => block.length > 0);

  return blocks.join('\n\n');
}
