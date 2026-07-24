/**
 * 最小 glob 匹配器：只支持 `*`（任意长度任意字符，含空串）。
 * 不引入 minimatch/picomatch 等重依赖——权限规则的 pattern 语法本迭代
 * 只需要前缀/通配匹配（如 `read`、`.uagent/plans/*.md`、`*`）。
 */
export function globMatch(input: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(input);
}
