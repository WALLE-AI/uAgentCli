/**
 * `local`：直接在宿主上执行。
 * `auto`：由调用方决定（本迭代等同 local）。
 * `sandbox`：请求了真正隔离，但本迭代没有实现容器/命名空间隔离，
 * 降级为 local，且强制走权限 ask（不是安全边界，只是启发式软围栏）。
 */
export type ExecutionMode = 'local' | 'auto' | 'sandbox';
