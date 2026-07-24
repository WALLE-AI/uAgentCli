import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Rule } from './types.js';

export type PersistScope = 'local' | 'user' | 'project';

export interface PersistPaths {
  /** `<projectRoot>/.uagent/settings.local.json`——不落 git，会话/本机专属。 */
  local: string;
  /** `<home>/settings.json`——用户全局配置。 */
  user: string;
  /** `<projectRoot>/.uagent/settings.json`——项目共享配置，通常入 git。 */
  project: string;
}

export function resolvePersistPaths(homeDir: string, projectRoot: string): PersistPaths {
  return {
    local: path.join(projectRoot, '.uagent', 'settings.local.json'),
    user: path.join(homeDir, 'settings.json'),
    project: path.join(projectRoot, '.uagent', 'settings.json'),
  };
}

export interface WritableFsLike {
  existsSync(target: string): boolean;
  readFileSync(target: string, encoding: 'utf-8'): string;
  writeFileSync(target: string, data: string, encoding: 'utf-8'): void;
  mkdirSync(target: string, options?: { recursive?: boolean }): unknown;
}

const DEFAULT_FS: WritableFsLike = { existsSync, readFileSync, writeFileSync, mkdirSync };

interface PersistedSettings {
  approvedRules: Rule[];
}

function loadSettings(filePath: string, fsImpl: WritableFsLike): PersistedSettings {
  if (!fsImpl.existsSync(filePath)) {
    return { approvedRules: [] };
  }
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf-8')) as Partial<PersistedSettings>;
    return { approvedRules: Array.isArray(parsed.approvedRules) ? parsed.approvedRules : [] };
  } catch {
    return { approvedRules: [] };
  }
}

/** 把一条 approved 规则追加写入指定层级的配置文件。 */
export function persistApprovedRule(
  scope: PersistScope,
  rule: Rule,
  paths: PersistPaths,
  fsImpl: WritableFsLike = DEFAULT_FS,
): void {
  const filePath = paths[scope];
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const settings = loadSettings(filePath, fsImpl);
  settings.approvedRules.push(rule);
  fsImpl.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function loadApprovedRules(
  scope: PersistScope,
  paths: PersistPaths,
  fsImpl: WritableFsLike = DEFAULT_FS,
): Rule[] {
  return loadSettings(paths[scope], fsImpl).approvedRules;
}

export interface PersistOnReplyInput {
  reply: 'once' | 'always' | 'reject';
  scope?: PersistScope;
}

/**
 * `once`/`reject` 不落盘（只影响运行时 approved，由 reply.ts 处理）；
 * `always` 才落盘到指定层级（默认 `local`，最不易造成跨会话意外放行）。
 */
export function persistOnReply(
  input: PersistOnReplyInput,
  rule: Rule,
  paths: PersistPaths,
  fsImpl: WritableFsLike = DEFAULT_FS,
): void {
  if (input.reply !== 'always') {
    return;
  }
  persistApprovedRule(input.scope ?? 'local', rule, paths, fsImpl);
}
