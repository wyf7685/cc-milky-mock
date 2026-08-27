import type { Server } from 'node:http';
import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import type { ActivityLog } from '@/state/activity.js';
import { createHttpServer } from '@/http/server.js';
import { resetStore } from '@/state/store.js';

let httpServer: Server | null = null;
let currentPort: number | null = null;
let resourceStoreRef: { cleanup(): void } | null = null;
let eventBusRef: EventBus | null = null;

export async function startServer(
  port: number,
  accessToken: string,
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
  activity: ActivityLog,
): Promise<string> {
  if (httpServer) await stopServer();

  resourceStoreRef = state.resourceStore;
  eventBusRef = events;
  httpServer = createHttpServer(accessToken, state, events, seq, activity);
  currentPort = port;

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const server = httpServer;
  server.listen(port, () => {
    console.error(`[milky-mcp] milky server started on http://localhost:${port}`);
    resolve([
      `milky server started on http://localhost:${port}`,
      `WebSocket: ws://localhost:${port}/event?access_token=${accessToken}`,
      `Access token: ${accessToken}`,
    ].join('\n'));
  });
  server.once('error', (error) => {
    if (httpServer === server) {
      httpServer = null;
      currentPort = null;
    }
    reject(error);
  });
  return promise;
}

export async function stopServer(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  eventBusRef?.disconnectAll();
  if (!httpServer) {
    resourceStoreRef?.cleanup();
    resolve();
    return promise;
  }

  const server = httpServer;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    console.error('[milky-mcp] milky server stopped');
    resourceStoreRef?.cleanup();
    httpServer = null;
    currentPort = null;
    resolve();
  };

  const timer = setTimeout(() => {
    console.error('[milky-mcp] force-closing milky server (connections did not drain)');
    server.closeAllConnections?.();
    finish();
  }, 2000);

  server.close(finish);
  return promise;
}
export function resetSimulation(
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
): void {
  resetStore(state);
  events.reset();
  seq.reset();
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
  activity: ActivityLog,
): void {
  resourceStoreRef = state.resourceStore;
  eventBusRef = events;

  server.registerTool(
    'stop_milky_server',
    {
      title: '停止 milky 服务器',
      description: '停止当前运行的 milky HTTP + WebSocket 服务器，并清空全部模拟状态、活动记录和临时资源',
      inputSchema: z.object({}),
    },
    async () => {
      const wasRunning = getServerStatus() !== null;
      await stopServer();
      resetSimulation(state, events, seq);
      const text = wasRunning
        ? JSON.stringify({ running: false, cleared: true, activity_cursor: activity.currentCursor() })
        : JSON.stringify({ running: false, cleared: true, activity_cursor: activity.currentCursor(), was_running: false });
      return { content: [{ type: 'text', text }] };
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
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            running: status != null,
            port: currentPort,
            connections: events.getConnectionCount(),
            activity_cursor: activity.currentCursor(),
          }),
        }],
      };
    },
  );
}
