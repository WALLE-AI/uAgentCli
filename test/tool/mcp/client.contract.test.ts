import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMcpClient } from '../../../src/tool/mcp/client.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

describe('McpClient (Streamable HTTP JSON-RPC transport)', () => {
  let server: http.Server;
  let baseUrl: string;
  let receivedMethods: string[];
  let receivedSessionIds: Array<string | undefined>;

  beforeEach(async () => {
    receivedMethods = [];
    receivedSessionIds = [];
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        const body = JSON.parse(raw) as JsonRpcRequest;
        receivedMethods.push(body.method);
        receivedSessionIds.push(req.headers['mcp-session-id'] as string | undefined);

        res.setHeader('content-type', 'application/json');
        res.setHeader('mcp-session-id', 'sess-abc');

        if (body.method === 'initialize') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2024-11-05' } }));
        } else if (body.method === 'tools/list') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { tools: [{ name: 'echo', description: 'echoes input', inputSchema: { type: 'object' } }] },
            }),
          );
        } else if (body.method === 'tools/call' && body.params.name === 'boom') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'tool exploded' } }));
        } else if (body.method === 'tools/call') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { echoed: body.params.arguments } }));
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'unknown method' } }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connect() performs the initialize handshake and remembers the session id', async () => {
    const client = createMcpClient();
    await client.connect(baseUrl);
    expect(receivedMethods).toEqual(['initialize']);
  });

  it('listTools() returns the tools reported by the server after connecting', async () => {
    const client = createMcpClient();
    await client.connect(baseUrl);
    const tools = await client.listTools();
    expect(tools).toEqual([{ name: 'echo', description: 'echoes input', inputSchema: { type: 'object' } }]);
  });

  it('callTool() posts tools/call with name+arguments and returns the result', async () => {
    const client = createMcpClient();
    await client.connect(baseUrl);
    const result = await client.callTool('echo', { a: 1 });
    expect(result).toEqual({ echoed: { a: 1 } });
  });

  it('reuses the session id returned by the server on subsequent calls', async () => {
    const client = createMcpClient();
    await client.connect(baseUrl);
    await client.listTools();
    expect(receivedSessionIds[1]).toBe('sess-abc');
  });

  it('surfaces a JSON-RPC error response as a thrown Error', async () => {
    const client = createMcpClient();
    await client.connect(baseUrl);
    await expect(client.callTool('boom', {})).rejects.toThrow(/tool exploded/);
  });

  it('listTools() before connect() throws a clear "not connected" error', async () => {
    const client = createMcpClient();
    await expect(client.listTools()).rejects.toThrow(/not connected/);
  });

  it('callTool() before connect() throws a clear "not connected" error', async () => {
    const client = createMcpClient();
    await expect(client.callTool('x', {})).rejects.toThrow(/not connected/);
  });
});
