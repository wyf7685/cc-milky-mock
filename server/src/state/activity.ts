import type { ClientApiCall, SimMessage } from '@/types.js';

export type ActivityType = 'event' | 'message' | 'api_call' | 'connection';

export interface ActivityRecord {
  cursor: number;
  type: ActivityType;
  time: number;
  direction?: 'inbound' | 'outbound';
  message_scene?: 'friend' | 'group' | 'temp';
  peer_id?: number;
  sender_id?: number;
  event_type?: string;
  api?: string;
  plain_text?: string;
  data: unknown;
}

export interface ActivityQuery {
  afterCursor?: number;
  limit?: number;
  types?: readonly ActivityType[];
  messageScene?: 'friend' | 'group' | 'temp';
  peerId?: number;
  senderId?: number;
  eventType?: string;
  api?: string;
  textContains?: string;
}

export interface ActivityQueryResult {
  activities: ActivityRecord[];
  nextCursor: number;
  currentCursor: number;
  oldestCursor: number;
  truncated: boolean;
}

const DEFAULT_CAPACITY = 2000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asScene(value: unknown): ActivityRecord['message_scene'] {
  return value === 'friend' || value === 'group' || value === 'temp' ? value : undefined;
}

export function getPlainText(segments: unknown): string | undefined {
  if (!Array.isArray(segments)) return undefined;

  const parts: string[] = [];
  for (const value of segments) {
    const segment = asRecord(value);
    if (!segment) continue;
    const fields = asRecord(segment.data) ?? segment;

    switch (segment.type) {
      case 'text': {
        const text = fields.text;
        if (typeof text === 'string') parts.push(text);
        break;
      }
      case 'mention': {
        const userId = fields.user_id;
        if (typeof userId === 'number' || typeof userId === 'string') parts.push(`@${userId}`);
        break;
      }
      case 'mention_all':
        parts.push('@全体成员');
        break;
    }
  }

  return parts.length > 0 ? parts.join('') : undefined;
}

export class ActivityLog {
  private readonly records: Array<ActivityRecord | undefined>;
  private readonly waiters = new Set<() => void>();
  private start = 0;
  private length = 0;
  private cursor = 0;

  constructor(private readonly capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Activity capacity must be a positive integer');
    }
    this.records = new Array<ActivityRecord | undefined>(capacity);
  }

  currentCursor(): number {
    return this.cursor;
  }

  appendEvent(event: Record<string, unknown>): ActivityRecord {
    const data = asRecord(event.data);
    const eventType = typeof event.event_type === 'string' ? event.event_type : undefined;
    const messageScene = asScene(data?.message_scene)
      ?? (asNumber(data?.group_id) != null ? 'group' : undefined)
      ?? (eventType?.startsWith('friend_') ? 'friend' : undefined);
    const peerId = asNumber(data?.peer_id ?? data?.group_id ?? data?.user_id ?? data?.initiator_id);
    const senderId = asNumber(data?.sender_id ?? data?.user_id ?? data?.initiator_id);

    return this.append({
      type: 'event',
      time: asNumber(event.time) ?? Math.floor(Date.now() / 1000),
      direction: eventType === 'message_receive' ? 'inbound' : undefined,
      message_scene: messageScene,
      peer_id: peerId,
      sender_id: senderId,
      event_type: eventType,
      plain_text: getPlainText(data?.segments),
      data: event,
    });
  }

  appendMessage(message: SimMessage): ActivityRecord {
    const data = {
      message_scene: message.scene,
      peer_id: message.peerId,
      message_seq: message.messageSeq,
      sender_id: message.senderId,
      time: message.time,
      segments: message.segments,
      recalled: message.recalled,
    };

    return this.append({
      type: 'message',
      time: message.time,
      direction: 'outbound',
      message_scene: message.scene,
      peer_id: message.peerId,
      sender_id: message.senderId,
      plain_text: getPlainText(message.segments),
      data,
    });
  }

  appendApiCall(call: ClientApiCall, senderId: number): ActivityRecord {
    const params = call.params;
    const messageScene = asScene(params.message_scene)
      ?? (asNumber(params.group_id) != null ? 'group' : undefined)
      ?? (asNumber(params.user_id) != null ? 'friend' : undefined);
    const peerId = asNumber(params.peer_id ?? params.group_id ?? params.user_id);
    const data = call.error == null ? call : { ...call, error: call.error };

    return this.append({
      type: 'api_call',
      time: call.time,
      direction: 'outbound',
      message_scene: messageScene,
      peer_id: peerId,
      sender_id: senderId,
      api: call.api,
      plain_text: getPlainText(params.message),
      data,
    });
  }

  appendConnection(
    transport: 'sse' | 'websocket',
    action: 'connected' | 'disconnected',
    count: number,
  ): ActivityRecord {
    const time = Math.floor(Date.now() / 1000);
    return this.append({
      type: 'connection',
      time,
      data: { transport, action, count, time },
    });
  }

  query(query: ActivityQuery = {}): ActivityQueryResult {
    const limit = Math.max(1, query.limit ?? 20);
    const oldestCursor = this.length > 0 ? this.get(0).cursor : this.cursor + 1;
    const truncated = query.afterCursor != null && query.afterCursor < oldestCursor - 1;

    if (query.afterCursor == null) {
      const activities: ActivityRecord[] = [];
      for (let offset = this.length - 1; offset >= 0 && activities.length < limit; offset -= 1) {
        const record = this.get(offset);
        if (this.matches(record, query)) activities.push(record);
      }
      activities.reverse();
      return {
        activities,
        nextCursor: this.cursor,
        currentCursor: this.cursor,
        oldestCursor,
        truncated: false,
      };
    }

    const activities: ActivityRecord[] = [];
    let nextCursor = query.afterCursor;
    for (let offset = 0; offset < this.length; offset += 1) {
      const record = this.get(offset);
      if (record.cursor <= query.afterCursor) continue;
      nextCursor = record.cursor;
      if (this.matches(record, query)) activities.push(record);
      if (activities.length >= limit) break;
    }

    if (activities.length < limit) nextCursor = this.cursor;
    return { activities, nextCursor, currentCursor: this.cursor, oldestCursor, truncated };
  }

  async wait(query: ActivityQuery, timeoutMs: number): Promise<ActivityQueryResult & { timedOut: boolean }> {
    const afterCursor = query.afterCursor ?? this.cursor;
    const incrementalQuery = { ...query, afterCursor };
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const result = this.query(incrementalQuery);
      if (result.activities.length > 0) return { ...result, timedOut: false };

      const remaining = deadline - Date.now();
      if (remaining <= 0) return { ...result, timedOut: true };
      await this.waitForChange(remaining);
    }
  }

  clear(): void {
    this.records.fill(undefined);
    this.start = 0;
    this.length = 0;
  }

  reset(): void {
    this.clear();
    this.cursor = 0;
  }

  private append(record: Omit<ActivityRecord, 'cursor'>): ActivityRecord {
    const activity = { ...record, cursor: ++this.cursor };
    if (this.length < this.capacity) {
      this.records[(this.start + this.length) % this.capacity] = activity;
      this.length += 1;
    } else {
      this.records[this.start] = activity;
      this.start = (this.start + 1) % this.capacity;
    }

    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const wake of waiters) wake();
    return activity;
  }

  private get(offset: number): ActivityRecord {
    return this.records[(this.start + offset) % this.capacity]!;
  }

  private matches(record: ActivityRecord, query: ActivityQuery): boolean {
    if (query.types && !query.types.includes(record.type)) return false;
    if (query.messageScene && record.message_scene !== query.messageScene) return false;
    if (query.peerId != null && record.peer_id !== query.peerId) return false;
    if (query.senderId != null && record.sender_id !== query.senderId) return false;
    if (query.eventType && record.event_type !== query.eventType) return false;
    if (query.api && record.api !== query.api) return false;
    if (query.textContains && !record.plain_text?.includes(query.textContains)) return false;
    return true;
  }

  private waitForChange(timeoutMs: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    let settled = false;
    let timer: NodeJS.Timeout;
    const wake = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.waiters.delete(wake);
      resolve();
    };
    timer = setTimeout(wake, timeoutMs);
    this.waiters.add(wake);
    return promise;
  }
}

