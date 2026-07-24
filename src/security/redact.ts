/**
 * §五 / M0.6 · 输出脱敏：工具结果回填进对话历史之前，脱敏常见机密格式。
 *
 * `REDACT_ENABLED` 在模块加载时读一次并冻结——运行时改 env 无法关闭脱敏
 * （防会话中途被诱导 `export UAGENT_REDACT_DISABLED=true`）。默认开启。
 *
 * 三层：①确定性厂商正则（AWS/GitHub/JWT/PEM/sk-*）②通用 KEY=VALUE / URL 凭据
 * ③Shannon 熵兜底（未知格式高熵孤立 token）。protected spans（URL/路径/data URI）
 * **仅对熵启发式豁免**——确定性正则仍照常脱敏。
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
  // 厂商专属（确定性，优先）
  { regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  { regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: '[REDACTED_JWT]' },
  { regex: /AKIA[A-Z0-9]{16}/g, replacement: '[REDACTED]' },
  { regex: /gh[pousr]_[A-Za-z0-9]{36,}/g, replacement: '[REDACTED]' },
  { regex: /sk-ant-[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { regex: /sk-[A-Za-z0-9]{20,}/g, replacement: '[REDACTED]' },
  { regex: /Bearer\s+[A-Za-z0-9._-]{10,}/gi, replacement: 'Bearer [REDACTED]' },
  // 通用 KEY=VALUE
  {
    regex: /((?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\s*[:=]\s*)['"]?[^\s'"]{6,}['"]?/gi,
    replacement: '$1[REDACTED]',
  },
  // URL 内嵌凭据 user:pass@host
  { regex: /(:\/\/[^:/\s]+:)([^@/\s]+)(@)/g, replacement: '$1[REDACTED]$3' },
];

const HIGH_ENTROPY_THRESHOLD = 4.375; // 3.5 + sensitivity(0.7)*1.25
const HIGH_ENTROPY_MIN_LEN = 24;
const HIGH_ENTROPY_CANDIDATE = /[A-Za-z0-9+/=_-]{24,}/g;

/** Shannon 熵（bits/char）。 */
export function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** URL / 文件路径 / data URI 的字节范围——仅对熵启发式豁免（防误伤长 hash 路径/base64 图片）。 */
function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns = [
    /https?:\/\/\S+/g,
    /data:[^\s,]+,[A-Za-z0-9+/=]+/g,
    /(?:\/[\w.-]+){2,}\/?/g, // unix 路径
  ];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

function overlaps(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([s, e]) => start < e && end > s);
}

export function redact(text: string): string {
  if (!REDACT_ENABLED) {
    return text;
  }

  // ①② 确定性正则（含厂商 + KEY=VALUE + URL 凭据）
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern.regex, pattern.replacement);
  }

  // ③ Shannon 熵兜底：len>=24 && 含字母含数字 && 熵>=阈值 && 不在 protected span
  const ranges = protectedRanges(result);
  result = result.replace(HIGH_ENTROPY_CANDIDATE, (match, offset: number) => {
    if (match.length < HIGH_ENTROPY_MIN_LEN) return match;
    if (overlaps(ranges, offset, offset + match.length)) return match; // URL/路径豁免
    if (!(/[A-Za-z]/.test(match) && /[0-9]/.test(match))) return match; // 需同时含字母数字
    if (shannonEntropy(match) < HIGH_ENTROPY_THRESHOLD) return match;
    return '[REDACTED_HIGH_ENTROPY_TOKEN]';
  });

  return result;
}

export function isRedactEnabled(): boolean {
  return REDACT_ENABLED;
}
