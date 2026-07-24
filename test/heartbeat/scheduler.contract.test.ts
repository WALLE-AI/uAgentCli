import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freeze, unfreeze, advance } from '../helpers/clock.js';
import { cronMatches, parseCron, HeartbeatScheduler } from '../../src/heartbeat/scheduler.js';
import { TriggerEngine } from '../../src/heartbeat/trigger-engine.js';

describe('parseCron / cronMatches', () => {
  it('parses a 5-field cron expression', () => {
    expect(parseCron('*/5 * * * *')).toEqual({
      minute: '*/5',
      hour: '*',
      dayOfMonth: '*',
      month: '*',
      dayOfWeek: '*',
    });
  });

  it('rejects expressions that do not have exactly 5 fields', () => {
    expect(() => parseCron('* * *')).toThrow(/expected 5 fields/);
  });

  it('matches step expressions (e.g. every 5 minutes)', () => {
    const schedule = parseCron('*/5 * * * *');
    expect(cronMatches(schedule, new Date(2026, 0, 1, 9, 0))).toBe(true);
    expect(cronMatches(schedule, new Date(2026, 0, 1, 9, 5))).toBe(true);
    expect(cronMatches(schedule, new Date(2026, 0, 1, 9, 7))).toBe(false);
  });

  it('matches exact fields for a fixed daily time', () => {
    const schedule = parseCron('30 9 * * *');
    expect(cronMatches(schedule, new Date(2026, 0, 1, 9, 30))).toBe(true);
    expect(cronMatches(schedule, new Date(2026, 0, 1, 9, 31))).toBe(false);
    expect(cronMatches(schedule, new Date(2026, 0, 1, 10, 30))).toBe(false);
  });
});

describe('HeartbeatScheduler (frozen-clock driven tick)', () => {
  afterEach(() => {
    unfreeze();
  });

  it('enqueues a job once its cron matches the frozen clock, advancing the clock triggers it', () => {
    freeze('2026-07-23T09:00:00');
    const scheduler = new HeartbeatScheduler();
    scheduler.register({ id: 'every-5-min', cron: '*/5 * * * *' });

    scheduler.tick(new Date());
    expect(scheduler.drainDueJobs()).toEqual(['every-5-min']);

    // 同一分钟内重复 tick 不重复入队（偏移量轮询去重）。
    scheduler.tick(new Date());
    expect(scheduler.drainDueJobs()).toEqual([]);

    advance(5 * 60 * 1000);
    scheduler.tick(new Date());
    expect(scheduler.drainDueJobs()).toEqual(['every-5-min']);
  });

  it('unregister() stops a job from ever being enqueued again', () => {
    freeze('2026-07-23T09:00:00');
    const scheduler = new HeartbeatScheduler();
    scheduler.register({ id: 'job-a', cron: '* * * * *' });
    scheduler.unregister('job-a');

    scheduler.tick(new Date());
    expect(scheduler.drainDueJobs()).toEqual([]);
  });

  it('start() polls on an interval and emits due jobs through the given TriggerEngine', async () => {
    freeze('2026-07-23T09:00:00');
    const scheduler = new HeartbeatScheduler();
    scheduler.register({ id: 'every-minute', cron: '* * * * *' });
    const engine = new TriggerEngine();
    const seen: unknown[] = [];
    engine.on('heartbeat.due', (payload) => {
      seen.push(payload);
    });

    const handle = scheduler.start(engine, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([{ jobId: 'every-minute' }]);

    handle.stop();
    seen.length = 0;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual([]);
  });
});

describe('TriggerEngine (event-driven skeleton)', () => {
  it('emits registered handlers with the given payload, in registration order', async () => {
    const engine = new TriggerEngine();
    const calls: unknown[] = [];
    engine.on('heartbeat.due', (payload) => {
      calls.push(payload);
    });
    engine.on('heartbeat.due', (payload) => {
      calls.push(payload);
    });

    await engine.emit('heartbeat.due', { jobId: 'x' });
    expect(calls).toEqual([{ jobId: 'x' }, { jobId: 'x' }]);
  });

  it('off() removes a specific handler without affecting others', async () => {
    const engine = new TriggerEngine();
    const calls: string[] = [];
    const handlerA = () => {
      calls.push('a');
    };
    const handlerB = () => {
      calls.push('b');
    };
    engine.on('e', handlerA);
    engine.on('e', handlerB);
    engine.off('e', handlerA);

    await engine.emit('e');
    expect(calls).toEqual(['b']);
  });

  describe('connectExternalSource (fileWatch)', () => {
    let dir: string;

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('emits on file changes under the watched path', async () => {
      dir = mkdtempSync(path.join(os.tmpdir(), 'uagentcli-trigger-'));
      const engine = new TriggerEngine();
      const events: unknown[] = [];
      engine.on('fs-change', (payload) => {
        events.push(payload);
      });

      const handle = engine.connectExternalSource('fs-change', { type: 'fileWatch', path: dir });
      try {
        writeFileSync(path.join(dir, 'a.txt'), 'hello', 'utf-8');
        await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
        expect(events[0]).toMatchObject({ path: dir });
      } finally {
        await handle.close();
      }
    });
  });

  describe('connectExternalSource (webhook)', () => {
    it('emits the parsed JSON body of POST requests', async () => {
      const engine = new TriggerEngine();
      const events: unknown[] = [];
      engine.on('webhook-in', (payload) => {
        events.push(payload);
      });

      const handle = engine.connectExternalSource('webhook-in', { type: 'webhook', port: 0 });
      try {
        const port = await handle.listening;
        const response = await fetch(`http://127.0.0.1:${port}`, {
          method: 'POST',
          body: JSON.stringify({ hello: 'world' }),
        });
        expect(response.status).toBe(200);
        await vi.waitFor(() => expect(events).toEqual([{ hello: 'world' }]));
      } finally {
        await handle.close();
      }
    });

    it('rejects non-POST requests with 405', async () => {
      const engine = new TriggerEngine();
      const handle = engine.connectExternalSource('webhook-in-2', { type: 'webhook', port: 0 });
      try {
        const port = await handle.listening;
        const response = await fetch(`http://127.0.0.1:${port}`, { method: 'GET' });
        expect(response.status).toBe(405);
      } finally {
        await handle.close();
      }
    });
  });
});
