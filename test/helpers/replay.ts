import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'replay');

/**
 * Provider 录画回放骨架：读取固定 fixture（预先录制的 SDK 事件序列），
 * 回放为 async iterable，供 llm/anthropic-provider 等模块做不烧 token
 * 的自动映射单测（迭代4 T4.2 / 迭代6 T6.6）。
 */
export function loadReplayFixture<T = unknown>(name: string): T[] {
  const file = path.join(FIXTURES_DIR, `${name}.json`);
  const raw = readFileSync(file, 'utf-8');
  return JSON.parse(raw) as T[];
}

export async function* replayEvents<T>(events: T[], signal?: AbortSignal): AsyncIterable<T> {
  for (const event of events) {
    if (signal?.aborted) {
      return;
    }
    yield event;
  }
}
