import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { PermissionManager } from '../../src/permission/manager.js';
import { toSessionID } from '../../src/types/ids.js';
import { createGateway, type GatewaySession } from '../../src/server/gateway.js';
import type { ApprovedStore } from '../../src/permission/reply.js';

let server: Server;
let baseUrl: string;
let manager: PermissionManager;
let approvedStore: ApprovedStore;
let sessions: Map<string, GatewaySession>;

beforeEach(async () => {
  manager = new PermissionManager();
  approvedStore = { rules: [] };
  sessions = new Map();
  server = createGateway({ manager, approvedStore, sessions });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('gateway HTTP endpoints', () => {
  it('POST /chat/send appends to session history; GET /chat/history returns it', async () => {
    await fetch(`${baseUrl}/chat/send`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', text: 'hello' }),
    });

    const res = await fetch(`${baseUrl}/chat/history?sessionId=s1`);
    const body = (await res.json()) as { messages: Array<{ content: Array<{ text: string }> }> };
    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content[0].text).toBe('hello');
  });

  it('GET /chat/history for an unknown session returns an empty list, not an error', async () => {
    const res = await fetch(`${baseUrl}/chat/history?sessionId=unknown`);
    const body = (await res.json()) as { messages: unknown[] };
    expect(res.status).toBe(200);
    expect(body.messages).toEqual([]);
  });

  it('POST /chat/abort triggers the AbortController.signal for that session', async () => {
    await fetch(`${baseUrl}/chat/send`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', text: 'hi' }),
    });

    const res = await fetch(`${baseUrl}/chat/abort`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1' }),
    });
    const body = (await res.json()) as { aborted: boolean };
    expect(body.aborted).toBe(true);
    expect(sessions.get('s1')?.controller.signal.aborted).toBe(true);
  });

  it('POST /permission/reply calls handleReply via RPC (not SSE) and settles the pending request', async () => {
    const pending = manager.ask({
      id: 'req-1',
      sessionID: toSessionID('s1'),
      action: 'write',
      patterns: ['file.txt'],
    });

    const res = await fetch(`${baseUrl}/permission/reply`, {
      method: 'POST',
      body: JSON.stringify({ requestID: 'req-1', reply: 'once' }),
    });
    expect(res.status).toBe(200);

    await expect(pending).resolves.toBe('allow');
  });

  it('a second /permission/reply for an already-settled request is a no-op, not an error', async () => {
    manager.ask({ id: 'req-1', sessionID: toSessionID('s1'), action: 'write', patterns: ['*'] });
    await fetch(`${baseUrl}/permission/reply`, {
      method: 'POST',
      body: JSON.stringify({ requestID: 'req-1', reply: 'once' }),
    });

    const second = await fetch(`${baseUrl}/permission/reply`, {
      method: 'POST',
      body: JSON.stringify({ requestID: 'req-1', reply: 'once' }),
    });
    expect(second.status).toBe(200);
  });

  it('unknown routes return 404', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
