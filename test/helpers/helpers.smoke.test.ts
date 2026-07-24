import { describe, expect, it, afterEach } from 'vitest';
import { advance, freeze, unfreeze } from './clock.js';
import { createFakeFs } from './fs.js';
import { createMemoryDb } from './sqlite.js';
import { createFakeSpawn } from './subprocess.js';
import { abortAfterCalls, createAbortController } from './abort.js';
import { loadReplayFixture, replayEvents } from './replay.js';
import { expectGolden } from './golden.js';

describe('test/helpers smoke', () => {
  afterEach(() => {
    unfreeze();
  });

  it('clock: freezes and advances deterministically', () => {
    freeze('2026-01-01T00:00:00.000Z');
    const t0 = Date.now();
    advance(60_000);
    const t1 = Date.now();
    expect(t1 - t0).toBe(60_000);
  });

  it('fs: memfs volume isolates files from real disk', () => {
    const { fs } = createFakeFs({ '/agents/db-reviewer.md': '# db reviewer' });
    const content = fs.readFileSync('/agents/db-reviewer.md', 'utf-8');
    expect(content).toBe('# db reviewer');
  });

  it('sqlite: in-memory db supports CRUD', () => {
    const db = createMemoryDb();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO t (name) VALUES (?)').run('alice');
    const row = db.prepare('SELECT name FROM t WHERE id = 1').get() as { name: string };
    expect(row.name).toBe('alice');
    db.close();
  });

  it('subprocess: fake spawn records calls and kill()', () => {
    const { spawn, calls } = createFakeSpawn();
    const child = spawn('echo', ['hi']);
    let exited = false;
    child.on('exit', () => {
      exited = true;
    });
    child.kill('SIGTERM');
    expect(calls).toEqual([{ command: 'echo', args: ['hi'] }]);
    expect(child.killed).toBe(true);
    expect(exited).toBe(true);
  });

  it('abort: controller aborts after N calls', () => {
    const controller = createAbortController();
    const tick = abortAfterCalls(controller, 3);
    tick();
    tick();
    expect(controller.signal.aborted).toBe(false);
    tick();
    expect(controller.signal.aborted).toBe(true);
  });

  it('replay: fixture replays as async iterable and respects abort', async () => {
    const events = loadReplayFixture<{ type: string }>('sample');
    const seen: string[] = [];
    for await (const event of replayEvents(events)) {
      seen.push(event.type);
    }
    expect(seen).toEqual(['text_delta', 'text_delta', 'finish']);
  });

  it('golden: byte-stable comparison across repeated calls', () => {
    const payload = JSON.stringify({ hello: 'world' });
    expectGolden('helpers-smoke-sample', payload);
    expectGolden('helpers-smoke-sample', payload);
  });
});
