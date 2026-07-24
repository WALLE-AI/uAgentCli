export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypass' | 'yolo';

function readBoolEnvOnce(name: string, env: NodeJS.ProcessEnv): boolean {
  const value = env[name];
  return value === '1' || value === 'true';
}

/**
 * 冻结护栏：启动时（模块首次加载时）读一次 bypass/yolo 使能开关并快照。
 * 运行时改 `process.env` 不再生效——防止模型/子进程在会话中途通过
 * 写环境变量的方式给自己开绿灯。
 */
const YOLO_ENABLED = readBoolEnvOnce('UAGENT_YOLO_ENABLED', process.env);
const BYPASS_ENABLED = readBoolEnvOnce('UAGENT_BYPASS_ENABLED', process.env);

export function isBypassModeEnabled(mode: PermissionMode): boolean {
  if (mode === 'yolo') {
    return YOLO_ENABLED;
  }
  if (mode === 'bypass') {
    return BYPASS_ENABLED;
  }
  return false;
}

/**
 * 可选的 fail-closed 分类器：判断当前 bypass/yolo 放行是否"足够安全"。
 * 返回 `true` 放行，`false` 或 `undefined`（分类器不可用/无法判断）一律
 * 降级为 ask，绝不因为分类器故障而静默放行。
 */
export type BypassClassifier = () => boolean | undefined;

export function resolveBypassDecision(
  mode: PermissionMode,
  classifier?: BypassClassifier,
): 'allow' | 'ask' {
  if (!isBypassModeEnabled(mode)) {
    return 'ask';
  }
  if (!classifier) {
    return 'allow';
  }
  const verdict = classifier();
  return verdict === true ? 'allow' : 'ask';
}
