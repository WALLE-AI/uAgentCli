import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage']);

/**
 * 递归列出 `root` 下的所有普通文件（相对路径），跳过常见的构建/依赖目录。
 * 用 `lstatSync` 而非 `statSync` 并跳过符号链接——`statSync` 会跟随链接，
 * 遇到指回祖先目录的符号链接（常见于 vendored/嵌套 checkout）会无限递归、
 * 撑爆内存，不是"稍微慢一点"的问题。
 */
export function walkFiles(root: string): string[] {
  const results: string[] = [];

  function visit(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) {
        continue;
      }
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        visit(full);
      } else if (stat.isFile()) {
        results.push(path.relative(root, full));
      }
    }
  }

  visit(root);
  return results;
}

/** 极简 glob→RegExp：支持 `*`（单段任意字符）、`**`（跨段任意）、`?`、`{a,b,c}`。 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 2;
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      out += '[^/]';
      i += 1;
    } else if (ch === '{') {
      const close = pattern.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
        i += 1;
      } else {
        const options = pattern
          .slice(i + 1, close)
          .split(',')
          .map((opt) => opt.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
        out += `(?:${options.join('|')})`;
        i = close + 1;
      }
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      out += `\\${ch}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}
