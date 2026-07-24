import type { SkillInfo } from './types.js';

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * `verbose:true` → XML（进 system prompt 的 `skills-verbose` stable
 * 段），`verbose:false` → terse markdown（供 `skill` 工具自身描述使用）。
 * 两种格式都只暴露 name/description/location，**不展开 SKILL.md 正文**
 * ——渐进披露，正文按需通过 `skill` 工具加载。
 */
export function formatSkills(list: SkillInfo[], options: { verbose: boolean }): string {
  if (list.length === 0) {
    return options.verbose ? '<available_skills>\n(no skills discovered)\n</available_skills>' : '(no skills discovered)';
  }

  if (options.verbose) {
    const items = list
      .map(
        (skill) =>
          `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.location)}</location>\n  </skill>`,
      )
      .join('\n');
    return `<available_skills>\n${items}\n</available_skills>`;
  }

  const lines = list.map((skill) => `- **${skill.name}**: ${skill.description}`);
  return `## Available Skills\n${lines.join('\n')}`;
}
