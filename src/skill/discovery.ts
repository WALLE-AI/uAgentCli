import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { SkillInfo } from './types.js';

export interface SkillFsLike {
  existsSync(target: string): boolean;
  readdirSync(target: string): string[];
  readFileSync(target: string, encoding: 'utf-8'): string;
  statSync(target: string): { isDirectory(): boolean };
}

const DEFAULT_FS: SkillFsLike = { existsSync, readdirSync, readFileSync, statSync };

const SKILL_FILENAME = 'SKILL.md';

function splitFrontmatter(content: string): { frontmatter: string; body: string } | null {
  if (!content.startsWith('---')) {
    return null;
  }
  const rest = content.slice(3);
  const closingIndex = rest.indexOf('\n---');
  if (closingIndex === -1) {
    return null;
  }
  const frontmatter = rest.slice(0, closingIndex).replace(/^\r?\n/, '');
  const body = rest.slice(closingIndex + 4).replace(/^\r?\n/, '');
  return { frontmatter, body };
}

function parseSkillFile(filePath: string, content: string): SkillInfo | undefined {
  const split = splitFrontmatter(content);
  if (!split) {
    return undefined;
  }
  let meta: unknown;
  try {
    meta = parseYaml(split.frontmatter);
  } catch {
    return undefined;
  }
  if (typeof meta !== 'object' || meta === null) {
    return undefined;
  }
  const m = meta as Record<string, unknown>;
  if (typeof m.name !== 'string' || typeof m.description !== 'string') {
    return undefined;
  }

  return {
    name: m.name,
    description: m.description,
    location: filePath,
    content: split.body,
  };
}

function walk(dir: string, fsImpl: SkillFsLike, found: SkillInfo[]): void {
  if (!fsImpl.existsSync(dir)) {
    return;
  }
  for (const entry of fsImpl.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fsImpl.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, fsImpl, found);
      continue;
    }
    if (entry === SKILL_FILENAME) {
      const skill = parseSkillFile(fullPath, fsImpl.readFileSync(fullPath, 'utf-8'));
      if (skill) {
        found.push(skill);
      }
    }
  }
}

/** 扫描给定目录（通常是各 `.agents/skills`）下所有 `**\/SKILL.md`。 */
export function discoverSkills(dirs: string[], fsImpl: SkillFsLike = DEFAULT_FS): SkillInfo[] {
  const found: SkillInfo[] = [];
  for (const dir of dirs) {
    walk(dir, fsImpl, found);
  }
  return found;
}
