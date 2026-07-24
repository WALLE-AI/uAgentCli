import type { Action, Decision } from './types.js';
import type { SessionID } from '../types/ids.js';

export interface PendingRequest {
  id: string;
  sessionID: SessionID;
  action: Action;
  /** 本次调用需要满足才算完全放行的具体 pattern（通常是路径/命令）。 */
  patterns: string[];
}

interface PendingEntry {
  info: PendingRequest;
  settle: (decision: Decision) => void;
}

/**
 * 挂起管理器：登记待批准请求，返回一个直到 settle 才 resolve 的
 * Promise。两条回填通道（CLI 终端直接 resolve / gateway RPC 远程调用）
 * 都通过同一个 `settle()` 收口——并发多端同时 settle 时先到先得，
 * 其余调用因为 pending 已被删除而变成 no-op，不抛错（§G）。
 */
export class PermissionManager {
  private readonly pending = new Map<string, PendingEntry>();

  ask(request: PendingRequest): Promise<Decision> {
    return new Promise((resolve) => {
      this.pending.set(request.id, { info: request, settle: resolve });
    });
  }

  /** 查看挂起请求的信息，不触发 settle。请求不存在时返回 undefined。 */
  peek(id: string): PendingRequest | undefined {
    return this.pending.get(id)?.info;
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  /**
   * settle 一个挂起请求。请求已被 settle 过或从不存在时返回 false
   * 且不抛错（幂等 no-op）；成功 settle 返回 true。
   */
  settle(id: string, decision: Decision): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }
    this.pending.delete(id);
    entry.settle(decision);
    return true;
  }

  listPending(sessionID: SessionID): PendingRequest[] {
    return [...this.pending.values()]
      .filter((entry) => entry.info.sessionID === sessionID)
      .map((entry) => entry.info);
  }
}
