import type { TriggerEngine } from './trigger-engine.js';

/**
 * §J 骨架模块：心跳调度器。"cron 解析 + 到期判定 + 手动推进（`tick`）"是
 * 确定性、可测的核心；`start()` 是生产落地的常驻轮询循环，挂 `setInterval`
 * 定期调用 `tick()`/`drainDueJobs()`，把到期 job 转发给 `TriggerEngine`。
 */
export interface CronSchedule {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

const CRON_FIELD_COUNT = 5;

export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== CRON_FIELD_COUNT) {
    throw new Error(`Invalid cron expression "${expr}": expected ${CRON_FIELD_COUNT} fields, got ${parts.length}.`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    if (part === '*') {
      return true;
    }
    if (part.includes('/')) {
      const [range, stepRaw] = part.split('/');
      const step = Number(stepRaw);
      const base = range === '*' ? 0 : Number(range);
      return Number.isFinite(step) && step > 0 && value >= base && (value - base) % step === 0;
    }
    return Number(part) === value;
  });
}

export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  return (
    fieldMatches(schedule.minute, date.getMinutes()) &&
    fieldMatches(schedule.hour, date.getHours()) &&
    fieldMatches(schedule.dayOfMonth, date.getDate()) &&
    fieldMatches(schedule.month, date.getMonth() + 1) &&
    fieldMatches(schedule.dayOfWeek, date.getDay())
  );
}

export interface HeartbeatJob {
  id: string;
  cron: string;
}

export interface HeartbeatSchedulerHandle {
  stop(): void;
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const HEARTBEAT_DUE_EVENT = 'heartbeat.due';

/** 按分钟粒度去重的偏移量轮询：同一分钟内重复 `tick()` 不重复入队。 */
export class HeartbeatScheduler {
  private readonly jobs = new Map<string, CronSchedule>();
  private readonly queue: string[] = [];
  private lastPolledMinuteKey: string | undefined;

  register(job: HeartbeatJob): void {
    this.jobs.set(job.id, parseCron(job.cron));
  }

  unregister(id: string): void {
    this.jobs.delete(id);
  }

  tick(now: Date): void {
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (minuteKey === this.lastPolledMinuteKey) {
      return;
    }
    this.lastPolledMinuteKey = minuteKey;

    for (const [id, schedule] of this.jobs) {
      if (cronMatches(schedule, now)) {
        this.queue.push(id);
      }
    }
  }

  drainDueJobs(): string[] {
    const due = [...this.queue];
    this.queue.length = 0;
    return due;
  }

  /**
   * 生产环境的常驻轮询循环：每 `intervalMs` 调一次 `tick(new Date())`，
   * 把到期 job 逐个转发给 `triggerEngine.emit('heartbeat.due', {jobId})`。
   * 返回的 handle 的 `stop()` 停止轮询（`unref()` 避免仅剩这一个定时器
   * 时还拖着进程不退出）。
   */
  start(triggerEngine: TriggerEngine, intervalMs = DEFAULT_POLL_INTERVAL_MS): HeartbeatSchedulerHandle {
    const interval = setInterval(() => {
      this.tick(new Date());
      for (const jobId of this.drainDueJobs()) {
        void triggerEngine.emit(HEARTBEAT_DUE_EVENT, { jobId });
      }
    }, intervalMs);
    interval.unref?.();

    return {
      stop: () => clearInterval(interval),
    };
  }
}
