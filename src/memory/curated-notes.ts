import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { threatScan } from '../security/threat-scan.js';

export interface CuratedNotesFsLike {
  existsSync(target: string): boolean;
  readFileSync(target: string, encoding: 'utf-8'): string;
  writeFileSync(target: string, data: string, encoding: 'utf-8'): void;
  mkdirSync(target: string, options?: { recursive?: boolean }): unknown;
  unlinkSync(target: string): void;
}

const DEFAULT_FS: CuratedNotesFsLike = { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync };

export const DEFAULT_NOTES_LIMIT = 2200; // MEMORY.md
export const DEFAULT_USER_PROFILE_LIMIT = 1375; // USER.md

const ENTRY_DELIMITER = '\n---\n';

function parseEntries(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/\n---\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function formatUsageHeader(charCount: number, limit: number, truncated: boolean): string {
  const pct = limit > 0 ? Math.round((charCount / limit) * 100) : 0;
  return `[${pct}% — ${charCount}/${limit}]${truncated ? ' [truncated]' : ''}`;
}

export interface CuratedNotesSnapshot {
  filePath: string;
  /** 原始文件字节（用于后续 `appendEntry` 的漂移检测基线）。 */
  rawContent: string;
  /** 逐条过 threat-scan 后的条目文本。 */
  entries: string[];
  blockedCount: number;
  /** 供 prompt 装配直接使用的格式化文本（含用量表头）。 */
  text: string;
  charCount: number;
  limit: number;
  loadedAt: number;
}

/**
 * **冻结快照**：本函数只读盘一次，返回的对象是一份独立快照——会话中途
 * 磁盘再被写入，不会改变已经返回的这份快照。要看到新内容，必须显式
 * 再调用一次 `loadSnapshot()`（对应 epoch 失效后重建）。
 */
export function loadSnapshot(
  filePath: string,
  limit: number,
  fsImpl: CuratedNotesFsLike = DEFAULT_FS,
  now: number = Date.now(),
): CuratedNotesSnapshot {
  const rawContent = fsImpl.existsSync(filePath) ? fsImpl.readFileSync(filePath, 'utf-8') : '';
  const rawEntries = parseEntries(rawContent);

  let blockedCount = 0;
  const entries = rawEntries.map((entry) => {
    const scan = threatScan(entry);
    if (scan.verdict === 'blocked') {
      blockedCount += 1;
    }
    return scan.clean;
  });

  let combined = entries.join(ENTRY_DELIMITER);
  let truncated = false;
  if (combined.length > limit) {
    combined = combined.slice(0, limit);
    truncated = true;
  }

  const header = formatUsageHeader(combined.length, limit, truncated);
  const text = `${header}\n${combined}`;

  return {
    filePath,
    rawContent,
    entries,
    blockedCount,
    text,
    charCount: combined.length,
    limit,
    loadedAt: now,
  };
}

export interface AppendEntryResult {
  ok: boolean;
  reason?: 'locked' | 'drift-detected';
}

/**
 * 原子写：`.lock` 文件占位期间拒绝并发写；写入前重读磁盘内容与调用方
 * 持有的 `expectedContent`（通常来自某次 `loadSnapshot().rawContent`）
 * 比对，不一致（说明磁盘在快照之后被别处改过）则拒绝写入，防止脏写覆盖。
 */
export function appendEntry(
  filePath: string,
  newEntry: string,
  expectedContent: string | undefined,
  fsImpl: CuratedNotesFsLike = DEFAULT_FS,
): AppendEntryResult {
  const lockPath = `${filePath}.lock`;
  if (fsImpl.existsSync(lockPath)) {
    return { ok: false, reason: 'locked' };
  }

  const currentContent = fsImpl.existsSync(filePath) ? fsImpl.readFileSync(filePath, 'utf-8') : '';
  if (expectedContent !== undefined && currentContent !== expectedContent) {
    return { ok: false, reason: 'drift-detected' };
  }

  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(lockPath, String(Date.now()), 'utf-8');
  try {
    const updated = currentContent.trim() ? `${currentContent}${ENTRY_DELIMITER}${newEntry}` : newEntry;
    fsImpl.writeFileSync(filePath, updated, 'utf-8');
    return { ok: true };
  } finally {
    fsImpl.unlinkSync(lockPath);
  }
}
