import type { Server } from 'node:http';
import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { createHttpServer } from '@/http/server.js';

let httpServer: Server | null = null;
let currentPort: number | null = null;
let resourceStoreRef: { cleanup(): void } | null = null;

export async function startServer(
  port: number,
  accessToken: string,
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
): Promise<string> {
  if (httpServer) await stopServer();

  resourceStoreRef = state.resourceStore;
  httpServer = createHttpServer(accessToken, state, events, seq);
  currentPort = port;

  return new Promise((resolve, reject) => {
    httpServer!.listen(port, () => {
      console.error(`[milky-mcp] milky server started on http://localhost:${port}`);
      resolve([
        `milky server started on http://localhost:${port}`,
        `WebSocket: ws://localhost:${port}/event?access_token=${accessToken}`,
        `Access token: ${accessToken}`,
      ].join('\n'));
    });
    httpServer!.on('error', (err) => reject(err));
  });
}

export async function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServer) { resolve(); return; }
    const server = httpServer;
    // Force-close after 2s if connections don't drain
    const timer = setTimeout(() => {
      console.error('[milky-mcp] force-closing milky server (connections did not drain)');
      server.closeAllConnections?.();
      finish();
    }, 2000);
    const finish = () => {
      clearTimeout(timer);
      console.error('[milky-mcp] milky server stopped');
      resourceStoreRef?.cleanup();
      httpServer = null;
      currentPort = null;
      resolve();
    };
    server.close(() => finish());
  });
}

export function setResourceStoreRef(store: { cleanup(): void }): void {
  resourceStoreRef = store;
}

export function getServerStatus(): string | null {
  if (!httpServer) return null;
  return `milky server is running on port ${currentPort}`;
}

export function getCurrentPort(): number | null {
  return currentPort;
}

export function registerServerTools(
  server: McpServer,
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
): void {
  server.registerTool(
    'start_milky_server',
    {
      title: '启动 milky 服务器',
      description:
        '启动 HTTP + WebSocket 服务器，供 milky 客户端连接。' +
        '如果已有运行中的实例，会先停止再启动新的。',
      inputSchema: z.object({
        port: z.number().int().min(1).max(65535).default(3000).describe('监听端口'),
        access_token: z
          .string()
          .default('milky-mock-token')
          .describe('Bearer token，客户端连接时需要提供'),
      }),
    },
    async ({ port, access_token }) => {
      try {
        const text = await startServer(port, access_token, state, events, seq);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed to start server: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'stop_milky_server',
    {
      title: '停止 milky 服务器',
      description: '停止当前运行的 milky HTTP + WebSocket 服务器',
      inputSchema: z.object({}),
    },
    async () => {
      if (!getServerStatus()) {
        return { content: [{ type: 'text', text: 'No milky server is running' }] };
      }
      await stopServer();
      return { content: [{ type: 'text', text: 'milky server stopped' }] };
    },
  );

  server.registerTool(
    'get_milky_server_status',
    {
      title: '查看 milky 服务器状态',
      description: '查看当前 milky 服务器的运行状态',
      inputSchema: z.object({}),
    },
    async () => {
      const status = getServerStatus();
      if (!status) return { content: [{ type: 'text', text: 'milky server is not running' }] };
      return { content: [{ type: 'text', text: `${status}\nActive connections: ${events.getConnectionCount()}` }] };
    },
  );
}
