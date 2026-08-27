import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerInspectTools } from '@/mcp/tools/inspect.js';
import { registerSimulateTools } from '@/mcp/tools/simulate.js';
import { ActivityLog } from '@/state/activity.js';
import { EventBus } from '@/state/events.js';
import { SequenceGenerator } from '@/state/sequences.js';
import { createStore } from '@/state/store.js';

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

type ToolHandler = (params: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

test('activity log provides bounded incremental cursors and uniform filters', () => {
  const activity = new ActivityLog(3);
  activity.appendEvent({
    time: 1,
    event_type: 'message_receive',
    data: {
      message_scene: 'group',
      peer_id: 123456,
      sender_id: 20001,
      segments: [{ type: 'text', data: { text: 'first' } }],
    },
  });
  activity.appendApiCall({
    api: 'send_group_nudge',
    params: { group_id: 123456 },
    time: 2,
  }, 10001);
  activity.appendMessage({
    scene: 'group',
    peerId: 123456,
    messageSeq: 2,
    senderId: 10001,
    time: 3,
    segments: [{ type: 'text', data: { text: 'reply' } }],
    recalled: false,
  });

  const incremental = activity.query({
    afterCursor: 1,
    types: ['message'],
    messageScene: 'group',
    peerId: 123456,
    textContains: 'reply',
  });
  assert.equal(incremental.activities.length, 1);
  assert.equal(incremental.activities[0]?.cursor, 3);
  assert.equal(incremental.activities[0]?.plain_text, 'reply');
  assert.equal(incremental.nextCursor, 3);
  assert.equal(incremental.truncated, false);

  activity.appendConnection('websocket', 'connected', 1);
  const truncated = activity.query({ afterCursor: 0 });
  assert.equal(truncated.oldestCursor, 2);
  assert.equal(truncated.truncated, true);

  activity.clear();
  assert.equal(activity.query().activities.length, 0);
  const cleared = activity.query({ afterCursor: 0 });
  assert.equal(cleared.truncated, true);
  assert.equal(cleared.oldestCursor, 5);
  assert.equal(activity.currentCursor(), 4);
  assert.equal(activity.appendConnection('websocket', 'connected', 1).cursor, 5);
});

test('activity wait ignores non-matches and returns the first matching activity', async () => {
  const activity = new ActivityLog();
  const pending = activity.wait({
    afterCursor: activity.currentCursor(),
    types: ['message'],
    peerId: 123456,
  }, 1000);

  activity.appendEvent({ event_type: 'group_nudge', data: { group_id: 123456 } });
  const groupEvents = activity.query({ types: ['event'], messageScene: 'group', peerId: 123456 });
  assert.equal(groupEvents.activities.length, 1);
  activity.appendMessage({
    scene: 'group',
    peerId: 123456,
    messageSeq: 1,
    senderId: 10001,
    time: 1,
    segments: [{ type: 'text', text: 'ready' }],
    recalled: false,
  });

  const result = await pending;
  assert.equal(result.timedOut, false);
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0]?.plain_text, 'ready');
});

test('simulate_message emits a real temp message and returns its activity cursor', async () => {
  const state = createStore();
  const activity = new ActivityLog();
  const events = new EventBus(activity);
  const seq = new SequenceGenerator();
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerSimulateTools(server, state, events, seq);

  try {
    const simulateMessage = handlers.get('simulate_message');
    assert.ok(simulateMessage);
    const response = await simulateMessage({
      message_scene: 'temp',
      peer_id: 20001,
      sender_id: 20001,
      segments: [{ type: 'text', text: 'temporary' }],
    });
    const output = JSON.parse(response.content[0]!.text) as { activity_cursor: number };
    assert.equal(output.activity_cursor, 1);

    const record = activity.query({ afterCursor: 0, types: ['event'] }).activities[0];
    assert.equal(record?.message_scene, 'temp');
    assert.equal(record?.plain_text, 'temporary');
    const event = record?.data as { data: Record<string, unknown> };
    assert.equal(event.data.message_scene, 'temp');
    assert.equal(event.data.group_member, undefined);
  } finally {
    state.resourceStore.cleanup();
  }
});

test('get_activity returns compact incremental output and clear_activity preserves the cursor', async () => {
  const state = createStore();
  const activity = new ActivityLog();
  const events = new EventBus(activity);
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerInspectTools(server, state, events, activity);

  try {
    events.emit({
      time: 1,
      event_type: 'message_receive',
      data: {
        message_scene: 'friend',
        peer_id: 20001,
        sender_id: 20001,
        segments: [{ type: 'text', data: { text: 'ping' } }],
      },
    });

    const getActivity = handlers.get('get_activity');
    assert.ok(getActivity);
    const response = await getActivity({
      after_cursor: 0,
      type: ['event'],
      limit: 20,
      wait_timeout_ms: 0,
      message_scene: 'friend',
      peer_id: 20001,
      text_contains: 'ping',
      include_state: true,
    });
    const output = JSON.parse(response.content[0]!.text) as {
      activities: Array<{ cursor: number; plain_text: string }>;
      next_cursor: number;
      state: { connections: number };
    };
    assert.deepEqual(output.activities.map((record) => record.cursor), [1]);
    assert.equal(output.activities[0]?.plain_text, 'ping');
    assert.equal(output.next_cursor, 1);
    assert.equal(output.state.connections, 0);

    const clearActivity = handlers.get('clear_activity');
    assert.ok(clearActivity);
    await clearActivity({});
    assert.equal(activity.query().activities.length, 0);
    assert.equal(activity.currentCursor(), 1);
  } finally {
    state.resourceStore.cleanup();
  }
});
