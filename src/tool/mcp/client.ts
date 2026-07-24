/**
 * MCP client：Streamable HTTP 传输（JSON-RPC 2.0 over HTTP POST）。
 * `connect(serverUrl: string)` 的签名只接受一个 URL，天然对应 HTTP 传输
 * 而非 stdio 子进程——不引入 `@modelcontextprotocol/sdk`，原生 `fetch`
 * 足够实现 initialize/tools.list/tools.call 三个方法。
 */
export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpClient {
  connect(serverUrl: string): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SESSION_ID_HEADER = 'mcp-session-id';

export function createMcpClient(): McpClient {
  let serverUrl: string | undefined;
  let sessionId: string | undefined;
  let nextId = 1;

  async function rpcCall(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!serverUrl) {
      throw new Error('McpClient is not connected — call connect(serverUrl) first.');
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (sessionId) {
      headers[SESSION_ID_HEADER] = sessionId;
    }

    const response = await fetch(serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });

    const receivedSessionId = response.headers.get(SESSION_ID_HEADER);
    if (receivedSessionId) {
      sessionId = receivedSessionId;
    }

    if (!response.ok) {
      throw new Error(`MCP server responded with HTTP ${response.status} for method "${method}"`);
    }

    const body = (await response.json()) as JsonRpcResponse;
    if (body.error) {
      throw new Error(`MCP error (${body.error.code}) for method "${method}": ${body.error.message}`);
    }
    return body.result;
  }

  return {
    async connect(url: string): Promise<void> {
      serverUrl = url;
      sessionId = undefined;
      await rpcCall('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'uagentcli', version: '0.0.1' },
      });
    },
    async listTools(): Promise<McpToolDescriptor[]> {
      const result = (await rpcCall('tools/list', {})) as { tools?: McpToolDescriptor[] } | undefined;
      return result?.tools ?? [];
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      return rpcCall('tools/call', { name, arguments: args });
    },
  };
}
