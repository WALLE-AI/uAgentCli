/**
 * §五 子进程 env 擦除：exec-gateway 派生任何子进程前，必须先用本模块
 * 处理一份环境变量副本，防止模型通过 `bash echo $ANTHROPIC_API_KEY`
 * 之类的命令把机密回显进对话历史。父进程自身的 `process.env` 不受影响。
 */
const SCRUB_PATTERNS: RegExp[] = [
  /_API_KEY$/i,
  /_TOKEN$/i,
  /_SECRET(_.*)?$/i,
  /_PASSWORD$/i,
  /_CREDENTIALS?$/i,
  /^AWS_SECRET_ACCESS_KEY$/i,
  /^AWS_SESSION_TOKEN$/i,
  /^ANTHROPIC_API_KEY$/i,
  /^OPENAI_API_KEY$/i,
];

function isScrubbed(key: string): boolean {
  return SCRUB_PATTERNS.some((pattern) => pattern.test(key));
}

/** 返回剥除机密变量后的**副本**，不修改传入对象。 */
export function scrubEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (isScrubbed(key)) {
      continue;
    }
    copy[key] = value;
  }
  return copy;
}
