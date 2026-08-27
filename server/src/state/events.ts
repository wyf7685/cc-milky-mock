import type { SSEStreamingApi } from 'hono/streaming';
import type { WebSocket } from 'ws';
import { ActivityLog, type ActivityRecord } from './activity.js';

export interface MilkyEvent {
  [key: string]: unknown;
}


export class EventBus {
  private sseClients = new Set<SSEStreamingApi>();
  private wsClients = new Set<WebSocket>();

  constructor(private readonly activity: ActivityLog) {}

  addSSEClient(stream: SSEStreamingApi): void {
    this.sseClients.add(stream);
    this.activity.appendConnection('sse', 'connected', this.getConnectionCount());
  }

  removeSSEClient(stream: SSEStreamingApi): void {
    if (!this.sseClients.delete(stream)) return;
    this.activity.appendConnection('sse', 'disconnected', this.getConnectionCount());
  }

  addWSClient(ws: WebSocket): void {
    this.wsClients.add(ws);
    this.activity.appendConnection('websocket', 'connected', this.getConnectionCount());
  }

  removeWSClient(ws: WebSocket): void {
    if (!this.wsClients.delete(ws)) return;
    this.activity.appendConnection('websocket', 'disconnected', this.getConnectionCount());
  }

  emit(event: MilkyEvent): ActivityRecord {
    const activity = this.activity.appendEvent(event);
    const data = JSON.stringify(event);

    for (const client of this.sseClients) {
      void client.writeSSE({ data, event: 'milky_event' }).catch(() => {
        this.removeSSEClient(client);
      });
    }

    for (const ws of this.wsClients) {
      try {
        ws.send(data);
      } catch {
        this.removeWSClient(ws);
      }
    }

    return activity;
  }
  disconnectAll(): void {
    const hadSSEClients = this.sseClients.size > 0;
    for (const client of this.sseClients) {
      void client.close().catch(() => undefined);
    }
    this.sseClients.clear();
    if (hadSSEClients) this.activity.appendConnection('sse', 'disconnected', this.getConnectionCount());

    const hadWSClients = this.wsClients.size > 0;
    for (const client of this.wsClients) {
      try {
        client.terminate();
      } catch {
        // The socket is already closed.
      }
    }
    this.wsClients.clear();
    if (hadWSClients) this.activity.appendConnection('websocket', 'disconnected', this.getConnectionCount());
  }

  reset(): void {
    this.activity.reset();
  }


  getConnectionCount(): number {
    return this.sseClients.size + this.wsClients.size;
  }
}
