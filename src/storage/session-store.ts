import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import type { Message } from '../types/message.js';
import type { Ruleset } from '../permission/types.js';

export interface SessionRecord {
  id: string;
  parentSessionId: string | null;
  projectId: string;
  agent: string;
  model: string;
  cwd: string;
  title: string | null;
  permission: Ruleset;
  tokens: number;
  cost: number;
  createdAt: number;
  archived: boolean;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: Message['role'];
  content: Message['content'];
  seq: number;
  toolCallId: string | null;
  tokens: number;
  createdAt: number;
  active: boolean;
}

interface SessionRow {
  id: string;
  parent_session_id: string | null;
  project_id: string;
  agent: string;
  model: string;
  cwd: string;
  title: string | null;
  permission: string;
  tokens: number;
  cost: number;
  created_at: number;
  archived: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  seq: number;
  tool_call_id: string | null;
  tokens: number;
  created_at: number;
  active: number;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id,
    projectId: row.project_id,
    agent: row.agent,
    model: row.model,
    cwd: row.cwd,
    title: row.title,
    permission: JSON.parse(row.permission) as Ruleset,
    tokens: row.tokens,
    cost: row.cost,
    createdAt: row.created_at,
    archived: row.archived === 1,
  };
}

function toMessageRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as Message['role'],
    content: JSON.parse(row.content) as Message['content'],
    seq: row.seq,
    toolCallId: row.tool_call_id,
    tokens: row.tokens,
    createdAt: row.created_at,
    active: row.active === 1,
  };
}

/** 建表：与 `permission/persist.ts` 共用同一 SQLite 连接（调用方负责传入）。 */
export function initSessionStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT,
      project_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      model TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT,
      permission TEXT NOT NULL DEFAULT '{"rules":[]}',
      tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_session_project ON session(project_id);
    CREATE INDEX IF NOT EXISTS idx_session_parent ON session(parent_session_id);

    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      seq INTEGER NOT NULL,
      tool_call_id TEXT,
      tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id);
  `);
}

export interface CreateSessionInput {
  id?: string;
  parentSessionId?: string | null;
  projectId: string;
  agent: string;
  model: string;
  cwd: string;
  title?: string | null;
  permission?: Ruleset;
  createdAt?: number;
}

export class SessionStore {
  constructor(private readonly db: Database.Database) {
    initSessionStore(db);
  }

  createSession(input: CreateSessionInput): SessionRecord {
    const record: SessionRecord = {
      id: input.id ?? randomUUID(),
      parentSessionId: input.parentSessionId ?? null,
      projectId: input.projectId,
      agent: input.agent,
      model: input.model,
      cwd: input.cwd,
      title: input.title ?? null,
      permission: input.permission ?? { rules: [] },
      tokens: 0,
      cost: 0,
      createdAt: input.createdAt ?? Date.now(),
      archived: false,
    };

    this.db
      .prepare(
        `INSERT INTO session (id, parent_session_id, project_id, agent, model, cwd, title, permission, tokens, cost, created_at, archived)
         VALUES (@id, @parentSessionId, @projectId, @agent, @model, @cwd, @title, @permission, @tokens, @cost, @createdAt, @archived)`,
      )
      .run({
        id: record.id,
        parentSessionId: record.parentSessionId,
        projectId: record.projectId,
        agent: record.agent,
        model: record.model,
        cwd: record.cwd,
        title: record.title,
        permission: JSON.stringify(record.permission),
        tokens: record.tokens,
        cost: record.cost,
        createdAt: record.createdAt,
        archived: 0,
      });

    return record;
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionRow | undefined;
    return row ? toSessionRecord(row) : undefined;
  }

  listSessionsByProject(projectId: string, options: { activeOnly?: boolean } = {}): SessionRecord[] {
    const rows = (
      options.activeOnly
        ? this.db.prepare('SELECT * FROM session WHERE project_id = ? AND archived = 0 ORDER BY created_at').all(projectId)
        : this.db.prepare('SELECT * FROM session WHERE project_id = ? ORDER BY created_at').all(projectId)
    ) as SessionRow[];
    return rows.map(toSessionRecord);
  }

  listChildSessions(parentSessionId: string): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM session WHERE parent_session_id = ? ORDER BY created_at')
      .all(parentSessionId) as SessionRow[];
    return rows.map(toSessionRecord);
  }

  archiveSession(id: string): void {
    this.db.prepare('UPDATE session SET archived = 1 WHERE id = ?').run(id);
  }

  appendMessage(input: {
    id?: string;
    sessionId: string;
    role: Message['role'];
    content: Message['content'];
    seq: number;
    toolCallId?: string | null;
    tokens?: number;
    createdAt?: number;
  }): MessageRecord {
    const record: MessageRecord = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      seq: input.seq,
      toolCallId: input.toolCallId ?? null,
      tokens: input.tokens ?? 0,
      createdAt: input.createdAt ?? Date.now(),
      active: true,
    };

    this.db
      .prepare(
        `INSERT INTO message (id, session_id, role, content, seq, tool_call_id, tokens, created_at, active)
         VALUES (@id, @sessionId, @role, @content, @seq, @toolCallId, @tokens, @createdAt, @active)`,
      )
      .run({
        id: record.id,
        sessionId: record.sessionId,
        role: record.role,
        content: JSON.stringify(record.content),
        seq: record.seq,
        toolCallId: record.toolCallId,
        tokens: record.tokens,
        createdAt: record.createdAt,
        active: 1,
      });

    return record;
  }

  /** resume：按 session_id + active 过滤，只取未归档消息，按 seq 排序。 */
  listMessages(sessionId: string, options: { activeOnly?: boolean } = {}): MessageRecord[] {
    const rows = (
      options.activeOnly
        ? this.db
            .prepare('SELECT * FROM message WHERE session_id = ? AND active = 1 ORDER BY seq')
            .all(sessionId)
        : this.db.prepare('SELECT * FROM message WHERE session_id = ? ORDER BY seq').all(sessionId)
    ) as MessageRow[];
    return rows.map(toMessageRecord);
  }

  deactivateMessages(sessionId: string, seqs: number[]): void {
    const stmt = this.db.prepare('UPDATE message SET active = 0 WHERE session_id = ? AND seq = ?');
    for (const seq of seqs) {
      stmt.run(sessionId, seq);
    }
  }
}
