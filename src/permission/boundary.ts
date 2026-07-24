import path from 'node:path';

/**
 * §三 边界检查：主 agent 的文件/命令活动被约束在 cwd + additionalDirs
 * 之内——这是权限层的软围栏，不是操作系统级隔离（§J）。
 */
export interface BoundaryContext {
  cwd: string;
  additionalDirs?: string[];
}

export function isPathInBoundary(target: string, ctx: BoundaryContext): boolean {
  const resolved = path.resolve(target);
  const dirs = [ctx.cwd, ...(ctx.additionalDirs ?? [])].map((dir) => path.resolve(dir));
  return dirs.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
}

/** 越界目标对应的 `external_directory` ask 规则：一次批准放行整个父目录。 */
export function externalDirectoryGlob(target: string): string {
  return path.join(path.dirname(path.resolve(target)), '*');
}

const DANGEROUS_PATH_PATTERNS: RegExp[] = [
  /(^|[/\\])\.git($|[/\\])/,
  /(^|[/\\])\.uagent($|[/\\])/,
  /(^|[/\\])\.ssh($|[/\\])/,
  /(^|[/\\])\.bashrc$/,
  /(^|[/\\])\.zshrc$/,
  /(^|[/\\])\.bash_profile$/,
  /(^|[/\\])\.mcp\.json$/,
];

/** DANGEROUS_FILES：命中触发 safetyCheck（gate 步骤6）。 */
export function isDangerousPath(target: string): boolean {
  return DANGEROUS_PATH_PATTERNS.some((pattern) => pattern.test(target));
}

const ENV_FILE_PATTERN = /(^|[/\\])\.env(\.[^/\\]+)?$/;
const ENV_EXAMPLE_PATTERN = /\.env\.example$/;

/** `.env` 读取显式触发 ask；`.env.example` 视为安全模板，不触发。 */
export function isEnvFileRead(target: string): boolean {
  return ENV_FILE_PATTERN.test(target) && !ENV_EXAMPLE_PATTERN.test(target);
}
