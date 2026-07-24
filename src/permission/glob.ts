/**
 * M0.2 · 富 glob 匹配器（移植 opencode `util/wildcard.ts`）。
 *
 * 支持 `*`（任意字符含空串）、`?`（单字符）、路径分隔符归一化。
 * 被权限规则匹配（`evaluate.ts`）与 hooks matcher（T7.10）共用——
 * 前置为 M0.2 避免两处各写一套导致语义漂移。
 *
 * 铁律：**非法正则一律 fail-closed 返回 false**（落默认 ask），绝不放宽。
 */

export interface GlobMatchOptions {
  /**
   * 大小写不敏感匹配。默认按平台：Windows 文件系统大小写不敏感，
   * 故 `win32` 默认 true，其余 false。可显式覆盖以获得确定性测试。
   */
  caseInsensitive?: boolean;
}

/**
 * `input` 是被测字符串（请求的资源名/路径），`pattern` 是规则里的 glob。
 * 注意调用顺序：`globMatch(input, rule.pattern)`，别写反。
 */
export function globMatch(input: string, pattern: string, options: GlobMatchOptions = {}): boolean {
  const caseInsensitive = options.caseInsensitive ?? process.platform === 'win32';

  // 反斜杠→正斜杠：跨平台路径归一化。
  const normalized = input.replaceAll('\\', '/');

  // 先转义正则元字符（不含 * ?），再把通配符翻成正则片段。
  let escaped = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  // "cmd *" → "cmd" 也允许（无参形式）。此时 pattern 结尾的 " *" 已变 " .*"。
  if (escaped.endsWith(' .*')) {
    escaped = `${escaped.slice(0, -3)}( .*)?`;
  }

  try {
    const flags = caseInsensitive ? 'si' : 's';
    return new RegExp(`^${escaped}$`, flags).test(normalized);
  } catch {
    // 病态 pattern 产出非法正则 → fail-closed。
    return false;
  }
}
