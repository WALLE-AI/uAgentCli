import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/**
 * §二 存储路径解析（前置到迭代2，解开迭代2↔迭代3 的循环依赖：
 * `permission/persist.ts` 落盘三层配置需要 home/project 目录，
 * 而完整的 session-store 建表要到迭代3 T3.1 才做）。
 */
export interface ScopePaths {
  home: string;
  project: string;
}

/** `UAGENT_HOME` 优先，否则 `~/.uagent`。project 目录是 home 下按 project_id 分区的子目录。 */
export function resolveScope(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): ScopePaths {
  const home = env.UAGENT_HOME && env.UAGENT_HOME.trim() !== '' ? env.UAGENT_HOME : path.join(os.homedir(), '.uagent');
  const projectId = sanitizeProjectId(cwd);
  return { home, project: path.join(home, 'projects', projectId) };
}

const HASH_LENGTH = 8;

/**
 * 把 cwd 转成幂等、文件系统安全的 project 标识：可读的 basename slug
 * + 完整路径的短 hash 后缀（避免不同路径下同名目录冲突）。
 * 多次调用同一 cwd 必须产出完全相同的结果。
 */
export function sanitizeProjectId(cwd: string): string {
  const normalized = path.resolve(cwd);
  const base = path.basename(normalized) || 'root';
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, HASH_LENGTH);
  return `${slug || 'root'}-${hash}`;
}
