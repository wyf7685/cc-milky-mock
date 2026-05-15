import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { getHandler, type ApiContext } from '@/api/registry.js';
import { ok, failed } from '@/api/response.js';
import { getMimeType } from '@/utils/image.js';

export function createHttpServer(
  accessToken: string,
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
): Server {
  const app = new Hono();
  const ctx: ApiContext = { state, events, seq };

  // Auth middleware: skip /resources/ (public), check Bearer token elsewhere
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/resources/')) {
      await next();
      return;
    }
    const authHeader = c.req.header('Authorization');
    let token = authHeader?.replace('Bearer ', '');
    if (!token) {
      token = c.req.query('access_token') ?? undefined;
    }
    if (token !== accessToken) {
      return c.json(failed(-1, 'Authentication failed'), 401);
    }
    await next();
  });

  // SSE event stream (fallback for non-WebSocket clients)
  app.get('/event', (c) => {
    return streamSSE(c, async (stream) => {
      events.addSSEClient(stream);
      stream.onAbort(() => {
        events.removeSSEClient(stream);
      });
      while (true) {
        await stream.writeSSE({ data: '', event: 'heartbeat' });
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    });
  });

  // Static resource serving for images/files
  app.get('/resources/:resourceId', (c) => {
    const id = c.req.param('resourceId');
    const filePath = state.resourceStore.getFilePath(id);
    if (!filePath || !existsSync(filePath)) {
      return c.json(failed(-1, 'Resource not found'), 404);
    }
    const ext = extname(filePath).slice(1);
    const mime = getMimeType(ext);
    const data = readFileSync(filePath);
    return new Response(data, {
      headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
    });
  });

  // API endpoint router
  app.post('/api/:apiName', async (c) => {
    const apiName = c.req.param('apiName');
    const handler = getHandler(apiName);

    if (!handler) {
      return c.json(failed(-1, `Unknown API endpoint: ${apiName}`), 404);
    }

    try {
      const contentType = c.req.header('Content-Type');
      if (contentType && !contentType.includes('application/json')) {
        return c.json(failed(-1, 'Content-Type must be application/json'), 415);
      }

      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const callRecord: { api: string; params: Record<string, unknown>; time: number; error?: string } = { api: apiName, params: body, time: Math.floor(Date.now() / 1000) };
      try {
        const result = await handler(body, ctx);
        state.clientApiCalls.push(callRecord);
        return c.json(ok(result));
      } catch (err) {
        callRecord.error = err instanceof Error ? err.message : String(err);
        state.clientApiCalls.push(callRecord);
        throw err;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(failed(-1, message));
    }
  });

  // Create Node HTTP server and attach WebSocket upgrade
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    const method = req.method ?? 'GET';
    let body: Buffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    const request = new Request(url.toString(), { method, headers, body });
    const response = await app.fetch(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      const reader = (response.body as ReadableStream).getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } else {
      res.end();
    }
  });

  // WebSocket server for /event
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/event') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('access_token');
    if (token !== accessToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      events.addWSClient(ws);
      console.error(`[milky-mcp] WebSocket client connected (total: ${events.getConnectionCount()})`);

      ws.on('close', () => {
        events.removeWSClient(ws);
        console.error(`[milky-mcp] WebSocket client disconnected (total: ${events.getConnectionCount()})`);
      });

      ws.on('error', () => {
        events.removeWSClient(ws);
      });
    });
  });

  return server;
}
