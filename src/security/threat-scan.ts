/**
 * §六 信息收费站：对进入上下文快照的外部/存储数据（记忆条目、
 * SOUL.md/AGENT.md、curated notes 等）做启发式指令注入扫描。
 * 这是关键词/结构启发式，不是真正的分类器——命中率与误报率都会
 * 随语料迭代调整，调用方应把它当作"降级为数据标签"的最后防线，
 * 而不是唯一防线。
 */

export type ThreatVerdict = 'clean' | 'blocked';

export interface ThreatScanResult {
  clean: string;
  verdict: ThreatVerdict;
  matches: string[];
}

interface ThreatPattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: ThreatPattern[] = [
  { name: 'ignore-previous-instructions', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i },
  { name: 'disregard-previous', regex: /disregard\s+(all\s+)?(previous|prior|above)/i },
  { name: 'role-hijack-en', regex: /you\s+are\s+now\s+(a|an)?\s*\S+/i },
  { name: 'reveal-system-prompt', regex: /reveal\s+(the\s+)?system\s+prompt/i },
  { name: 'fake-role-marker', regex: /\[\s*system\s*\]|<\|im_start\|>|<\|system\|>/i },
  { name: 'ignore-previous-zh', regex: /忽略(之前|以上|上面|上述)(的)?(所有)?(指令|要求|规则|提示)/ },
  { name: 'role-hijack-zh', regex: /你现在是|现在你是|从现在开始你是/ },
  { name: 'reveal-system-prompt-zh', regex: /(泄露|展示|打印|输出)(你的)?系统提示/ },
];

const FULLWIDTH_START = 0xff01;
const FULLWIDTH_END = 0xff5e;
const FULLWIDTH_TO_ASCII_OFFSET = 0xfee0;

/** 把全角 ASCII 字符归一化为半角，防止简单的全角字符混淆绕过关键词匹配。 */
function normalizeFullwidth(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= FULLWIDTH_START && code <= FULLWIDTH_END) {
      result += String.fromCodePoint(code - FULLWIDTH_TO_ASCII_OFFSET);
    } else {
      result += ch;
    }
  }
  return result;
}

const EXCERPT_LENGTH = 80;

export function threatScan(text: string): ThreatScanResult {
  const normalized = normalizeFullwidth(text);
  const matches = PATTERNS.filter((p) => p.regex.test(normalized)).map((p) => p.name);

  if (matches.length === 0) {
    return { clean: text, verdict: 'clean', matches: [] };
  }

  const excerpt = text.slice(0, EXCERPT_LENGTH);
  return {
    clean: `[BLOCKED: potential instruction injection detected, ${text.length} chars, excerpt="${excerpt}"]`,
    verdict: 'blocked',
    matches,
  };
}
