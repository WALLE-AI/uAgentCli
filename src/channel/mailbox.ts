import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { AgentInfo } from '../agent/types.js';
import { resolveScope } from '../storage/paths.js';

/**
 * teammate agent↔agent 文件邮箱：一个收件人一个 JSONL 文件，`send()` 追加
 * 一行，`receive()` 读出全部未读行后清空文件（"取走即已读"语义）。单进程
 * REPL 场景不需要跨进程锁；`SendMessage` 只能发给 `mode:'teammate'` agent
 * 的约束校验独立于文件邮箱是否已实现。
 */
export interface MailboxMessage {
  from: string;
  to: string;
  body: string;
}

export function assertTeammateMode(agent: Pick<AgentInfo, 'mode' | 'name'>): void {
  if (agent.mode !== 'teammate') {
    throw new Error(`SendMessage only supports agents in "teammate" mode (agent "${agent.name}" is "${agent.mode}").`);
  }
}

export interface Mailbox {
  send(message: MailboxMessage): Promise<void>;
  receive(agentName: string): Promise<MailboxMessage[]>;
}

function defaultBaseDir(): string {
  return path.join(resolveScope().home, 'mailbox');
}

export class FileMailbox implements Mailbox {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? defaultBaseDir();
  }

  private inboxPath(agentName: string): string {
    return path.join(this.baseDir, `${agentName}.jsonl`);
  }

  async send(message: MailboxMessage): Promise<void> {
    mkdirSync(this.baseDir, { recursive: true });
    appendFileSync(this.inboxPath(message.to), `${JSON.stringify(message)}\n`, 'utf-8');
  }

  async receive(agentName: string): Promise<MailboxMessage[]> {
    const file = this.inboxPath(agentName);
    if (!existsSync(file)) {
      return [];
    }

    const content = readFileSync(file, 'utf-8');
    const messages = content
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as MailboxMessage);

    // 读取后清空（"取走即已读"）：先写到临时文件再原子 rename，避免和并发
    // send() 的 append 交错成半行 JSON。
    const emptyFile = path.join(this.baseDir, `.tmp-${randomUUID()}`);
    writeFileSync(emptyFile, '', 'utf-8');
    renameSync(emptyFile, file);

    return messages;
  }
}
