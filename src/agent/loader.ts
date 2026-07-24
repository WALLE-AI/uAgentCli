import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { AgentInfo, AgentMemoryScope, AgentMode, AgentSource } from './types.js';

export interface FsLike {
  existsSync(target: string): boolean;
  readdirSync(target: string): string[];
  readFileSync(target: string, encoding: 'utf-8'): string;
}

export interface LoaderIssue {
  file: string;
  message: string;
}

export interface LoadAgentsResult {
  agents: AgentInfo[];
  issues: LoaderIssue[];
}

const DEFAULT_FS: FsLike = { existsSync, readdirSync, readFileSync };

const VALID_MODES: AgentMode[] = ['asTool', 'teammate'];
const VALID_MEMORY_SCOPES: AgentMemoryScope[] = ['user', 'project', 'local'];

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
  const afterClose = rest.slice(closingIndex + 4);
  const body = afterClose.replace(/^\r?\n/, '');
  return { frontmatter, body };
}

function parseAgentFile(
  file: string,
  content: string,
  source: AgentSource,
): { agent: AgentInfo } | { issue: string } {
  const split = splitFrontmatter(content);
  if (!split) {
    return { issue: 'missing frontmatter (file must start with a --- YAML block)' };
  }

  let meta: unknown;
  try {
    meta = parseYaml(split.frontmatter);
  } catch (error) {
    return { issue: `invalid YAML frontmatter: ${(error as Error).message}` };
  }

  if (typeof meta !== 'object' || meta === null) {
    return { issue: 'frontmatter must be a YAML mapping' };
  }
  const m = meta as Record<string, unknown>;

  if (typeof m.name !== 'string' || m.name.trim() === '') {
    return { issue: 'frontmatter.name must be a non-empty string' };
  }
  if (typeof m.description !== 'string' || m.description.trim() === '') {
    return { issue: 'frontmatter.description must be a non-empty string' };
  }

  const mode: AgentMode = m.mode === undefined ? 'asTool' : (m.mode as AgentMode);
  if (!VALID_MODES.includes(mode)) {
    return { issue: `frontmatter.mode must be one of ${VALID_MODES.join('/')}` };
  }

  const prompt = split.body.trim();
  if (prompt === '') {
    return { issue: 'agent body (prompt) must not be empty' };
  }

  if (m.tools !== undefined && !(Array.isArray(m.tools) && m.tools.every((t) => typeof t === 'string'))) {
    return { issue: 'frontmatter.tools must be a string array' };
  }
  if (m.model !== undefined && typeof m.model !== 'string') {
    return { issue: 'frontmatter.model must be a string' };
  }
  if (m.memory !== undefined && !VALID_MEMORY_SCOPES.includes(m.memory as AgentMemoryScope)) {
    return { issue: `frontmatter.memory must be one of ${VALID_MEMORY_SCOPES.join('/')}` };
  }
  if (m.maxTurns !== undefined && typeof m.maxTurns !== 'number') {
    return { issue: 'frontmatter.maxTurns must be a number' };
  }
  if (m.omitProjectDoc !== undefined && typeof m.omitProjectDoc !== 'boolean') {
    return { issue: 'frontmatter.omitProjectDoc must be a boolean' };
  }
  if (m.background !== undefined && typeof m.background !== 'boolean') {
    return { issue: 'frontmatter.background must be a boolean' };
  }

  const agent: AgentInfo = {
    name: m.name,
    description: m.description,
    mode,
    source,
    prompt,
    tools: m.tools as string[] | undefined,
    model: m.model as string | undefined,
    memory: m.memory as AgentMemoryScope | undefined,
    maxTurns: m.maxTurns as number | undefined,
    omitProjectDoc: m.omitProjectDoc as boolean | undefined,
    background: false,
  };

  return { agent };
}

interface ScanDir {
  source: Exclude<AgentSource, 'builtin' | 'flag'>;
  dir: string;
}

/**
 * 扫描 `~/.uagent/agents` 与 `./.uagent/agents` 下的 `*.md`，解析成 AgentInfo。
 * project 目录后扫描，同名覆盖 user。异常路径（缺 frontmatter/字段类型错/空正文）
 * 记录到 issues，不静默吞掉、不加入结果集。
 */
export function loadAgentsFromMarkdown(
  scanDirs: ScanDir[],
  fsImpl: FsLike = DEFAULT_FS,
): LoadAgentsResult {
  const byName = new Map<string, AgentInfo>();
  const issues: LoaderIssue[] = [];

  for (const { source, dir } of scanDirs) {
    if (!fsImpl.existsSync(dir)) {
      continue;
    }
    const entries = fsImpl.readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const entry of entries) {
      const filePath = path.join(dir, entry);
      const content = fsImpl.readFileSync(filePath, 'utf-8');
      const result = parseAgentFile(filePath, content, source);
      if ('issue' in result) {
        issues.push({ file: filePath, message: result.issue });
        continue;
      }
      byName.set(result.agent.name, result.agent);
    }
  }

  return { agents: [...byName.values()], issues };
}

export function defaultScanDirs(homeDir: string, cwd: string): ScanDir[] {
  return [
    { source: 'user', dir: path.join(homeDir, '.uagent', 'agents') },
    { source: 'project', dir: path.join(cwd, '.uagent', 'agents') },
  ];
}
