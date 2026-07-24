import { Volume, createFsFromVolume, type IFs } from 'memfs';

/**
 * 隔离盘 helper：基于 memfs 的内存文件系统卷，避免 identity-files /
 * curated-notes / loader 等模块的单测依赖真实磁盘。
 */
export interface FakeFs {
  fs: IFs;
  volume: InstanceType<typeof Volume>;
  /** 与 Node `fs` 结构兼容的收窄视图，适配只需要 string[]/string 的调用方。 */
  fsLike: SimpleFsLike;
}

export function createFakeFs(initial: Record<string, string> = {}): FakeFs {
  const volume = Volume.fromJSON(initial);
  const fs = createFsFromVolume(volume);
  return { fs, volume, fsLike: toFsLike(fs) };
}

/**
 * memfs 的 `IFs.readdirSync` 联合类型比 Node 原生 `fs` 宽（可能返回
 * Dirent/Buffer），结构上无法直接赋给只需要 `string[]` 的调用方
 * （如 `agent/loader.ts` 的 `FsLike`）。这里做一层收窄适配。
 */
export interface SimpleFsLike {
  existsSync(target: string): boolean;
  readdirSync(target: string): string[];
  readFileSync(target: string, encoding: 'utf-8'): string;
  writeFileSync(target: string, data: string, encoding: 'utf-8'): void;
  mkdirSync(target: string, options?: { recursive?: boolean }): unknown;
  statSync(target: string): { isDirectory(): boolean };
  unlinkSync(target: string): void;
}

export function toFsLike(fs: IFs): SimpleFsLike {
  return {
    existsSync: (target) => fs.existsSync(target),
    readdirSync: (target) => (fs.readdirSync(target) as Array<string | Buffer>).map((name) => String(name)),
    readFileSync: (target, encoding) => fs.readFileSync(target, encoding) as string,
    writeFileSync: (target, data, encoding) => {
      fs.writeFileSync(target, data, encoding as never);
    },
    mkdirSync: (target, options) => fs.mkdirSync(target, options),
    statSync: (target) => fs.statSync(target),
    unlinkSync: (target) => fs.unlinkSync(target),
  };
}
