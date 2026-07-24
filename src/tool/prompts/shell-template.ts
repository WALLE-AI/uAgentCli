/**
 * bash 工具描述的唯一动态模板（其余工具描述均为静态 .txt 资产，
 * 不允许运行时插值，避免打破缓存前缀稳定性）。
 */
export interface ShellTemplateInput {
  os: string;
  shell: string;
  cwd: string;
}

export function renderShellPrompt(input: ShellTemplateInput): string {
  return [
    `Execute a shell command via ${input.shell} on ${input.os}.`,
    `Current working directory: ${input.cwd}`,
    'Prefer read-only commands when possible. Long-running or destructive',
    'commands should be avoided unless explicitly required by the task.',
  ].join('\n');
}
