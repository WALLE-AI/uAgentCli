/**
 * §四 命令风险识别，两档：
 * - `detectDangerous`（软线）：可疑但不是绝对禁止的模式，命中走 gate
 *   步骤5 内容级 ask，yolo/bypass 可以放行。
 * - `detectHardline`（硬线）：无论任何模式都拒绝，不进入 ask 队列。
 *
 * 本迭代用简单正则/分词，**不是安全边界**——真正的语法级解析
 * （tree-sitter-bash AST）是明确标注的未来升级点，这里只是启发式。
 */

const HARDLINE_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+\/(\s|$)/i,
  /\brm\b.*--no-preserve-root/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // classic fork bomb
  /\bmkfs\.\w+\s+\/dev\/\w+/i,
  />\s*\/dev\/(sd|nvme|hd|xvd)\w*/i,
  /\bdd\b.*\bof=\/dev\/(sd|nvme|hd|xvd)\w*/i,
];

const DANGEROUS_PATTERNS: RegExp[] = [
  /\$\(/, // command substitution
  /`[^`]*`/, // backtick substitution
  /\$\{IFS[:}]/i, // $IFS-based obfuscation
  /\/proc\/(self|\d+)\/environ/i,
  /\|\s*(sh|bash|zsh)\b/i, // piping into a shell
  /curl[^|]*\|\s*(sh|bash)\b/i,
  /\$'[^']*'/, // ANSI-C quoted obfuscated flags
];

export function detectHardline(command: string): boolean {
  return HARDLINE_PATTERNS.some((pattern) => pattern.test(command));
}

export function detectDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}
