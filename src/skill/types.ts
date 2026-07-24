/**
 * 渐进披露：`content`（SKILL.md 正文）随对象保留，供 `skill` 工具按需
 * 加载全文，但 verbose/terse 两种格式化输出（见 registry.ts）都不展开它。
 */
export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  content: string;
}
