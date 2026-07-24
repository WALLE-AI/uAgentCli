/**
 * 强制重新求值一个模块（绕过 Vite/Vitest 的模块缓存），用于测试
 * "冻结开关只在模块加载时读一次 env"这类语义——给同一路径追加不同的
 * query string 会让 Vite 把它当作不同的模块图节点重新执行。
 *
 * TypeScript 无法静态解析带 query string 的动态 import 路径，
 * 这里集中一处 `@ts-expect-error` 而不是散落在各个测试文件里。
 */
export async function freshImport<T>(specifier: string): Promise<T> {
  return import(specifier);
}
