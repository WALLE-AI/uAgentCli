import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { threatScan, type ThreatScanResult } from '../security/threat-scan.js';

export interface IdentityFsLike {
  existsSync(target: string): boolean;
  readFileSync(target: string, encoding: 'utf-8'): string;
  writeFileSync(target: string, data: string, encoding: 'utf-8'): void;
  mkdirSync(target: string, options?: { recursive?: boolean }): unknown;
}

const DEFAULT_FS: IdentityFsLike = { existsSync, readFileSync, writeFileSync, mkdirSync };

export const DEFAULT_SOUL = `# SOUL

You are a careful, transparent coding assistant. Prefer asking over guessing
on destructive or ambiguous actions. Explain the "why" behind non-obvious
decisions, not just the "what".
`;

export interface IdentityPaths {
  userSoul: string;
  projectSoul: string;
}

export function resolveIdentityPaths(homeDir: string, projectRoot: string): IdentityPaths {
  return {
    userSoul: path.join(homeDir, 'SOUL.md'),
    projectSoul: path.join(projectRoot, '.uagent', 'SOUL.md'),
  };
}

function ensureFileDir(target: string, fsImpl: IdentityFsLike): void {
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
}

/**
 * 首次不存在则用 `DEFAULT_SOUL` 种入并返回；已存在（无论是默认内容还是
 * 用户改过的内容）一律原样读取，**绝不回写覆盖**。
 */
function loadOrSeed(filePath: string, fsImpl: IdentityFsLike): string {
  if (!fsImpl.existsSync(filePath)) {
    ensureFileDir(filePath, fsImpl);
    fsImpl.writeFileSync(filePath, DEFAULT_SOUL, 'utf-8');
    return DEFAULT_SOUL;
  }
  return fsImpl.readFileSync(filePath, 'utf-8');
}

/** project SOUL.md 存在则优先于 user SOUL.md；user 级别负责首启种入。 */
export function loadSoul(paths: IdentityPaths, fsImpl: IdentityFsLike = DEFAULT_FS): ThreatScanResult {
  const userContent = loadOrSeed(paths.userSoul, fsImpl);
  const content = fsImpl.existsSync(paths.projectSoul)
    ? fsImpl.readFileSync(paths.projectSoul, 'utf-8')
    : userContent;
  return threatScan(content);
}

const AGENT_DOC_ALIASES = ['AGENT.md', 'AGENTS.md', 'CLAUDE.md'];

export interface AgentDocResult {
  path: string;
  scan: ThreatScanResult;
}

/**
 * 从 `startDir` 向上 walk-up 到 `.git` 所在目录（含）为止，逐级按别名
 * 顺序 `AGENT.md → AGENTS.md → CLAUDE.md` 查找。**首命中即停，不跨祖先
 * 目录堆叠**——找到就返回，不会把多层祖先的文档都拼进来。
 */
export function findAgentDoc(startDir: string, fsImpl: IdentityFsLike = DEFAULT_FS): AgentDocResult | undefined {
  let dir = path.resolve(startDir);

  while (true) {
    for (const alias of AGENT_DOC_ALIASES) {
      const candidate = path.join(dir, alias);
      if (fsImpl.existsSync(candidate)) {
        return { path: candidate, scan: threatScan(fsImpl.readFileSync(candidate, 'utf-8')) };
      }
    }

    if (fsImpl.existsSync(path.join(dir, '.git'))) {
      break;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return undefined;
}
