import { createHash, createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * M0.3 · 篡改可检测的审计哈希链（移植 zeroclaw `security/audit.rs`）。
 *
 * 每条审计事件链接前一条：`entry_hash = H(prev_hash ‖ canonicalJSON(payload))`，
 * genesis 的 `prev_hash = "0"*64`。改动任一历史记录都会使其后所有 entry_hash
 * 失配（`verifyChain` 检出）。落 M0.1 的 `audit_log` 表。
 *
 * 复用点：T8.2 权限决策 / T10.3 沙盒违规 / T13(X.2) gateway reply（本地远程审批）。
 *
 * ⚠ canonical JSON 字段顺序必须稳定（递归按键排序），否则重算 entry_hash 永失配。
 * ⚠ entry_hash 只 hash payload + 外部 prev_hash，**不含** prev_hash/entry_hash 自身。
 */

export const GENESIS_PREV_HASH = '0'.repeat(64);

export interface AuditActor {
  channel?: string;
  userId?: string | null;
}
export interface AuditAction {
  command?: string;
  riskLevel?: string;
  approved?: boolean;
}
export interface AuditResult {
  success?: boolean;
  exitCode?: number | null;
  durationMs?: number | null;
}
export interface AuditSecurity {
  policyViolation?: boolean;
  sandboxBackend?: string | null;
}

export interface AuditEventInput {
  eventId: string;
  timestamp: number;
  eventType: string;
  actor?: AuditActor;
  action?: AuditAction;
  result?: AuditResult;
  security?: AuditSecurity;
  agentAlias?: string | null;
}

export interface AuditEntry extends AuditEventInput {
  sequence: number;
  prevHash: string;
  entryHash: string;
}

/** 递归按键排序的确定性 JSON（undefined 字段被剔除，与 JSON 语义一致）。 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJSON(v === undefined ? null : v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

interface HashPayload {
  sequence: number;
  event_id: string;
  timestamp: number;
  event_type: string;
  actor?: AuditActor;
  action?: AuditAction;
  result?: AuditResult;
  security?: AuditSecurity;
  agent_alias?: string | null;
}

function buildPayload(sequence: number, input: AuditEventInput): HashPayload {
  return {
    sequence,
    event_id: input.eventId,
    timestamp: input.timestamp,
    event_type: input.eventType,
    actor: input.actor,
    action: input.action,
    result: input.result,
    security: input.security,
    agent_alias: input.agentAlias ?? undefined,
  };
}

function computeEntryHash(prevHash: string, payload: HashPayload, signingKey?: Buffer): string {
  const material = prevHash + canonicalJSON(payload);
  if (signingKey) {
    return createHmac('sha256', signingKey).update(material).digest('hex');
  }
  return createHash('sha256').update(material).digest('hex');
}

export interface AuditSinkOptions {
  /** 可选 HMAC 签名密钥；提供时必须恰好 32 字节，否则抛错（不静默不签）。 */
  signingKey?: Buffer;
}

interface AuditRow {
  sequence: number;
  event_id: string;
  timestamp: number;
  event_type: string;
  actor: string | null;
  action: string | null;
  result: string | null;
  security: string | null;
  agent_alias: string | null;
  prev_hash: string;
  entry_hash: string;
}

export class AuditSink {
  private lastSequence = 0;
  private lastHash = GENESIS_PREV_HASH;
  private readonly signingKey?: Buffer;

  constructor(private readonly db: Database.Database, options: AuditSinkOptions = {}) {
    if (options.signingKey && options.signingKey.length !== 32) {
      throw new Error(`AuditSink: signingKey must be 32 bytes, got ${options.signingKey.length}`);
    }
    this.signingKey = options.signingKey;
    // 续链：读末条，恢复 sequence 与 prev_hash。
    const last = this.db
      .prepare('SELECT sequence, entry_hash FROM audit_log ORDER BY sequence DESC LIMIT 1')
      .get() as { sequence: number; entry_hash: string } | undefined;
    if (last) {
      this.lastSequence = last.sequence;
      this.lastHash = last.entry_hash;
    }
  }

  append(input: AuditEventInput): AuditEntry {
    const sequence = this.lastSequence + 1;
    const prevHash = this.lastHash;
    const payload = buildPayload(sequence, input);
    const entryHash = computeEntryHash(prevHash, payload, this.signingKey);

    this.db
      .prepare(
        `INSERT INTO audit_log
           (sequence, event_id, timestamp, event_type, actor, action, result, security, agent_alias, prev_hash, entry_hash)
         VALUES (@sequence, @event_id, @timestamp, @event_type, @actor, @action, @result, @security, @agent_alias, @prev_hash, @entry_hash)`,
      )
      .run({
        sequence,
        event_id: input.eventId,
        timestamp: input.timestamp,
        event_type: input.eventType,
        actor: input.actor ? JSON.stringify(input.actor) : null,
        action: input.action ? JSON.stringify(input.action) : null,
        result: input.result ? JSON.stringify(input.result) : null,
        security: input.security ? JSON.stringify(input.security) : null,
        agent_alias: input.agentAlias ?? null,
        prev_hash: prevHash,
        entry_hash: entryHash,
      });

    this.lastSequence = sequence;
    this.lastHash = entryHash;
    return { ...input, sequence, prevHash, entryHash };
  }
}

export interface VerifyResult {
  ok: boolean;
  /** 首个失配的 sequence（ok=true 时为 undefined）。 */
  brokenAt?: number;
  reason?: string;
}

/**
 * 逐条校验：sequence 连续、prev_hash 链接、entry_hash 重算一致。
 * 篡改任一历史记录 → 从被改处起 brokenAt。
 */
export function verifyChain(db: Database.Database, options: AuditSinkOptions = {}): VerifyResult {
  if (options.signingKey && options.signingKey.length !== 32) {
    throw new Error(`verifyChain: signingKey must be 32 bytes, got ${options.signingKey.length}`);
  }
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY sequence ASC').all() as AuditRow[];
  let expectedSeq = 1;
  let prevHash = GENESIS_PREV_HASH;

  for (const row of rows) {
    if (row.sequence !== expectedSeq) {
      return { ok: false, brokenAt: row.sequence, reason: `sequence gap: expected ${expectedSeq}` };
    }
    if (row.prev_hash !== prevHash) {
      return { ok: false, brokenAt: row.sequence, reason: 'prev_hash linkage broken' };
    }
    const payload: HashPayload = {
      sequence: row.sequence,
      event_id: row.event_id,
      timestamp: row.timestamp,
      event_type: row.event_type,
      actor: row.actor ? (JSON.parse(row.actor) as AuditActor) : undefined,
      action: row.action ? (JSON.parse(row.action) as AuditAction) : undefined,
      result: row.result ? (JSON.parse(row.result) as AuditResult) : undefined,
      security: row.security ? (JSON.parse(row.security) as AuditSecurity) : undefined,
      agent_alias: row.agent_alias ?? undefined,
    };
    const recomputed = computeEntryHash(prevHash, payload, options.signingKey);
    if (recomputed !== row.entry_hash) {
      return { ok: false, brokenAt: row.sequence, reason: 'entry_hash mismatch (tampered)' };
    }
    prevHash = row.entry_hash;
    expectedSeq += 1;
  }
  return { ok: true };
}
