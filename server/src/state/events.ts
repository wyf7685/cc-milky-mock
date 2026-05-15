import type { SSEStreamingApi } from 'hono/streaming';
import type { WebSocket } from 'ws';

export interface MilkyEvent {
  [key: string]: unknown;
}

const EVENT_LOG_MAX = 1000;

export class EventBus {
  private sseClients = new Set<SSEStreamingApi>();
  private wsClients = new Set<WebSocket>();
  private eventLog: MilkyEvent[] = [];

  addSSEClient(stream: SSEStreamingApi): void {
    this.sseClients.add(stream);
  }

  removeSSEClient(stream: SSEStreamingApi): void {
    this.sseClients.delete(stream);
  }

  addWSClient(ws: WebSocket): void {
    this.wsClients.add(ws);
  }

  removeWSClient(ws: WebSocket): void {
    this.wsClients.delete(ws);
  }

  emit(event: MilkyEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > EVENT_LOG_MAX) {
      this.eventLog.shift();
    }

    const data = JSON.stringify(event);

    for (const client of this.sseClients) {
      try {
        client.writeSSE({ data, event: 'milky_event' });
      } catch {
        this.sseClients.delete(client);
      }
    }

    for (const ws of this.wsClients) {
      try {
        ws.send(data);
      } catch {
        this.wsClients.delete(ws);
      }
    }
  }

  getRecentEvents(limit = 50): MilkyEvent[] {
    return this.eventLog.slice(-limit);
  }

  getConnectionCount(): number {
    return this.sseClients.size + this.wsClients.size;
  }
}
