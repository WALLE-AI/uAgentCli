import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, '..', 'golden');

/**
 * 字节级黄金文件比较：用于 buildSystemPrompt / assembleContext 等
 * "相同输入产出字节稳定输出"的幂等单测。首次运行写入文件；之后逐字节比对。
 * 设置 UPDATE_GOLDEN=1 可主动刷新基线（需人工审阅 diff 后提交）。
 */
export function expectGolden(name: string, actual: string): void {
  if (!existsSync(GOLDEN_DIR)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
  }
  const file = path.join(GOLDEN_DIR, `${name}.golden`);

  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
    writeFileSync(file, actual, 'utf-8');
    return;
  }

  const expected = readFileSync(file, 'utf-8');
  expect(actual).toBe(expected);
}
