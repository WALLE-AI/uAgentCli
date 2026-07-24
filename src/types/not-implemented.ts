/**
 * 迭代6"接口占位"档 Task 的统一错误类型：只留接口签名、编译可调用，
 * 实现延后。调用即抛，不静默返回假数据——契约测试断言"抛这个类型"。
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (接口占位，实现延后到后续迭代).`);
    this.name = 'NotImplementedError';
  }
}
