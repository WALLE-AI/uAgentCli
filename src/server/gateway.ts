import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Message } from '../types/message.js';
import type { PermissionManager } from '../permission/manager.js';
import { handleReply, type ApprovedStore, type ReplyInput } from '../permission/reply.js';

export interface GatewaySession {
  id: string;
  controller: AbortController;
  history: Message[];
}

export interface GatewayDeps {
  manager: PermissionManager;
  approvedStore: ApprovedStore;
  sessions?: Map<string, GatewaySession>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function getOrCreateSession(sessions: Map<string, GatewaySession>, id: string): GatewaySession {
  let session = sessions.get(id);
  if (!session) {
    session = { id, controller: new AbortController(), history: [] };
    sessions.set(id, session);
  }
  return session;
}

/**
 * §G 极简 HTTP+SSE gateway：`chat.send`/`chat.history`/`chat.abort` +
 * `permission.reply` RPC。SSE 是单向推送（服务端→客户端），approval 的
 * **回复**必须走独立的 `permission.reply` RPC，不能通过 SSE 通道回传
 * ——多端并发 reply 时，`handleReply`/`manager.settle` 本身就是幂等
 * 先到先得，其余调用天然变成 no-op。
 */
export function createGateway(deps: GatewayDeps): Server {
  const sessions = deps.sessions ?? new Map<string, GatewaySession>();
  const sseClients = new Set<ServerResponse>();

  return createServer(async (req, res) => {
    const url = req.url ?? '';

    try {
      if (req.method === 'POST' && url === '/chat/send') {
        const body = JSON.parse(await readBody(req)) as { sessionId: string; text: string };
        const session = getOrCreateSession(sessions, body.sessionId);
        session.history.push({
          role: 'user',
          seq: session.history.length + 1,
          content: [{ type: 'text', text: body.text }],
        });
        sendJson(res, 202, { accepted: true });
        return;
      }

      if (req.method === 'GET' && url.startsWith('/chat/history')) {
        const sessionId = new URL(url, 'http://localhost').searchParams.get('sessionId') ?? '';
        const session = sessions.get(sessionId);
        sendJson(res, 200, { messages: session?.history ?? [] });
        return;
      }

      if (req.method === 'POST' && url === '/chat/abort') {
        const body = JSON.parse(await readBody(req)) as { sessionId: string };
        const session = sessions.get(body.sessionId);
        session?.controller.abort();
        sendJson(res, 200, { aborted: Boolean(session) });
        return;
      }

      if (req.method === 'POST' && url === '/permission/reply') {
        const body = JSON.parse(await readBody(req)) as ReplyInput;
        handleReply(deps.manager, deps.approvedStore, body);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && url === '/chat/stream') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(':ok\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
