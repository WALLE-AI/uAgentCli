import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { webFetchTool } from '../../../src/tool/builtin/webfetch.js';

function makeCtx(): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('webfetch tool', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head><style>.x{}</style></head><body><p>Hello <b>World</b></p></body></html>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('plain text body');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns plain text bodies as-is', async () => {
    const result = await webFetchTool.execute({ url: `${baseUrl}/plain` }, makeCtx());
    expect(result.output).toContain('plain text body');
  });

  it('strips HTML tags/scripts/styles for text/html responses', async () => {
    const result = await webFetchTool.execute({ url: `${baseUrl}/html` }, makeCtx());
    expect(result.output).toBe('Hello World');
  });

  it('is marked untrustedOutput so wrap.ts fences the result', () => {
    expect(webFetchTool.untrustedOutput).toBe(true);
  });

  it('is marked read-only and concurrency-safe', () => {
    expect(webFetchTool.isReadOnly).toBe(true);
    expect(webFetchTool.isConcurrencySafe).toBe(true);
  });
});
