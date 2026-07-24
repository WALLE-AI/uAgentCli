/**
 * §五 输出脱敏：在工具结果回填进对话历史之前，正则脱敏常见机密格式。
 * `REDACT_ENABLED` 在模块加载时读一次并冻结——运行时改 env 无法
 * 关闭脱敏（防止会话中途被诱导 `export UAGENT_REDACT_DISABLED=true`）。
 * 默认开启，只能通过启动时配置显式关闭。
 */
function readEnvOnce(): boolean {
  const value = process.env.UAGENT_REDACT_DISABLED;
  return !(value === '1' || value === 'true');
}

const REDACT_ENABLED = readEnvOnce();

interface RedactPattern {
  regex: RegExp;
  replacement: string;
}

const PATTERNS: RedactPattern[] = [
  { regex: /sk-ant-[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { regex: /sk-[A-Za-z0-9]{20,}/g, replacement: '[REDACTED]' },
  { regex: /Bearer\s+[A-Za-z0-9._-]{10,}/gi, replacement: 'Bearer [REDACTED]' },
  {
    regex: /((?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\s*[:=]\s*)['"]?[^\s'"]{6,}['"]?/gi,
    replacement: '$1[REDACTED]',
  },
  { regex: /(:\/\/[^:/\s]+:)([^@/\s]+)(@)/g, replacement: '$1[REDACTED]$3' },
];

export function redact(text: string): string {
  if (!REDACT_ENABLED) {
    return text;
  }
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern.regex, pattern.replacement);
  }
  return result;
}

export function isRedactEnabled(): boolean {
  return REDACT_ENABLED;
}
