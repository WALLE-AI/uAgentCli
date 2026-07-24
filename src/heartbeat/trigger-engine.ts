import { watch as fsWatch } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 事件驱动触发的最小可扩展骨架：进程内 pub-sub，供 `HeartbeatScheduler`
 * 到期入队后 `emit`，也支持外部事件源接入（`connectExternalSource`）。
 */
export type TriggerHandler = (payload: unknown) => void | Promise<void>;

export interface ExternalSourceHandle {
  close(): Promise<void>;
  /** webhook 源专属：resolve 实际监听到的端口（`port:0` 时由 OS 分配）。 */
  listening?: Promise<number>;
}

export type ExternalSourceConfig =
  | { type: 'fileWatch'; path: string }
  | { type: 'webhook'; port: number };

export class TriggerEngine {
  private readonly handlers = new Map<string, TriggerHandler[]>();

  on(event: string, handler: TriggerHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event: string, handler: TriggerHandler): void {
    const list = this.handlers.get(event);
    if (!list) {
      return;
    }
    this.handlers.set(
      event,
      list.filter((h) => h !== handler),
    );
  }

  async emit(event: string, payload?: unknown): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      await handler(payload);
    }
  }

  /**
   * 外部事件源接入点：`fileWatch` 用 `node:fs.watch` 监听目录/文件变化，
   * `webhook` 用 `node:http` 起一个最小 HTTP 服务接收 POST body（JSON）。
   * 两者都只是把外部信号转成 `emit(name, payload)`，不引入额外依赖。
   */
  connectExternalSource(name: string, config: ExternalSourceConfig): ExternalSourceHandle {
    if (config.type === 'fileWatch') {
      const watcher = fsWatch(config.path, (eventType, filename) => {
        void this.emit(name, { path: config.path, eventType, filename });
      });
      return {
        close: () =>
          new Promise((resolve) => {
            watcher.close();
            resolve();
          }),
      };
    }

    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        let payload: unknown = raw;
        try {
          payload = raw.length > 0 ? JSON.parse(raw) : {};
        } catch {
          // not JSON — forward the raw string body as-is.
        }
        void this.emit(name, payload);
        res.writeHead(200);
        res.end();
      });
    });
    const listening = new Promise<number>((resolve) => {
      server.once('listening', () => resolve((server.address() as AddressInfo).port));
    });
    server.listen(config.port);

    return {
      close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
      listening,
    };
  }
}
