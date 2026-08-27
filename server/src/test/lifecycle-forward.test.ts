import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { registerAllHandlers, type ApiHandler } from '@/api/registry.js';
import { registerMessageHandlers } from '@/api/handlers/message.js';
import { EventBus } from '@/state/events.js';
import { ActivityLog } from '@/state/activity.js';
import { SequenceGenerator } from '@/state/sequences.js';
import { createStore } from '@/state/store.js';
import { getServerStatus, resetSimulation, startServer, stopServer } from '@/mcp/tools/server.js';
import { convertToIncoming } from '@/mcp/tools/simulate.js';
import type { SimMessageSegment } from '@/types.js';

const ONE_PIXEL_PNG = 'base64://iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zb5sAAAAASUVORK5CYII=';

async function getUnusedPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createTcpServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Failed to allocate a TCP port'));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

test('reset clears simulation data and the resource store remains reusable', async () => {
  const state = createStore();
  const activity = new ActivityLog();
  const events = new EventBus(activity);
  const seq = new SequenceGenerator();

  try {
    state.users.set(20001, { userId: 20001, nickname: 'Alice' });
    activity.appendApiCall({ api: 'get_login_info', params: {}, time: 1 }, state.bot.uin);
    events.emit({ event_type: 'message_receive' });
    assert.equal(seq.next('message'), 1);

    const first = await state.resourceStore.resolveAndStore(ONE_PIXEL_PNG);
    assert.equal(existsSync(first.filePath), true);

    resetSimulation(state, events, seq);

    assert.equal(state.users.size, 0);
    assert.equal(activity.currentCursor(), 0);
    assert.equal(activity.query().activities.length, 0);
    assert.equal(seq.next('message'), 1);
    assert.equal(state.resourceStore.getEntry(first.resourceId), undefined);

    const second = await state.resourceStore.resolveAndStore(ONE_PIXEL_PNG);
    assert.equal(existsSync(second.filePath), true);
  } finally {
    state.resourceStore.cleanup();
  }
});

test('inline forward input registers content for get_forwarded_messages', async () => {
  const state = createStore();
  const activity = new ActivityLog();
  const events = new EventBus(activity);
  const seq = new SequenceGenerator();

  try {
    const segment = await convertToIncoming({
      type: 'forward',
      forward_id: 'forward_fixture',
      messages: [{
        user_id: 20001,
        sender_name: 'Alice',
        segments: [{ type: 'text', text: 'hello' }],
      }],
    }, state, seq);

    assert.deepEqual(segment, {
      type: 'forward',
      data: {
        forward_id: 'forward_fixture',
        title: '聊天记录',
        preview: ['Alice: hello'],
        summary: '查看1条转发消息',
      },
    });

    const handlers = new Map<string, ApiHandler>();
    registerMessageHandlers(handlers);
    const handler = handlers.get('get_forwarded_messages');
    assert.ok(handler);

    const response = await handler(
      { forward_id: 'forward_fixture' },
      { state, events, seq, activity },
    ) as { messages: Array<Record<string, unknown>> };

    assert.equal(response.messages.length, 1);
    assert.equal(response.messages[0]?.sender_name, 'Alice');
    assert.deepEqual(response.messages[0]?.segments, [
      { type: 'text', data: { text: 'hello' } },
    ]);
  } finally {
    state.resourceStore.cleanup();
  }
});

test('listen failure does not leave the server marked as running', async () => {
  const blocker = createTcpServer();
  blocker.listen(0);
  await once(blocker, 'listening');
  const address = blocker.address();
  assert.ok(address && typeof address !== 'string');

  const state = createStore();
  const activity = new ActivityLog();
  const events = new EventBus(activity);
  const seq = new SequenceGenerator();

  try {
    await assert.rejects(
      () => startServer(address.port, 'test-token', state, events, seq, activity),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'EADDRINUSE',
    );
    assert.equal(getServerStatus(), null);
  } finally {
    blocker.close();
    await once(blocker, 'close');
    await stopServer();
    resetSimulation(state, events, seq);
  }
});

test('HTTP server serves registered forwards and resources after restart', async () => {
  const state = createStore();
  const activity = new ActivityLog();
  const events = new EventBus(activity);
  const seq = new SequenceGenerator();
  const port = await getUnusedPort();
  const accessToken = 'test-token';
  registerAllHandlers();

  try {
    await startServer(port, accessToken, state, events, seq, activity);
    const client = new WebSocket(`ws://localhost:${port}/event?access_token=${accessToken}`);
    await once(client, 'open');
    assert.equal(events.getConnectionCount(), 1);
    await convertToIncoming({
      type: 'forward',
      forward_id: 'forward_http',
      messages: [{
        user_id: 20001,
        sender_name: 'Alice',
        segments: [{ type: 'text', text: 'through HTTP' }],
      }],
    }, state, seq);

    const apiResponse = await fetch(`http://localhost:${port}/api/get_forwarded_messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ forward_id: 'forward_http' }),
    });
    const apiBody = await apiResponse.json() as {
      status: string;
      data: { messages: Array<{ sender_name: string; segments: SimMessageSegment[] }> };
    };
    assert.equal(apiResponse.status, 200);
    assert.equal(apiBody.status, 'ok');
    assert.equal(apiBody.data.messages[0]?.sender_name, 'Alice');
    assert.deepEqual(apiBody.data.messages[0]?.segments, [
      { type: 'text', data: { text: 'through HTTP' } },
    ]);

    await stopServer();
    assert.equal(events.getConnectionCount(), 0);
    await startServer(port, accessToken, state, events, seq, activity);
    const resource = await state.resourceStore.resolveAndStore(ONE_PIXEL_PNG);
    const resourceResponse = await fetch(`http://localhost:${port}/resources/${resource.resourceId}`);
    assert.equal(resourceResponse.status, 200);
  } finally {
    await stopServer();
    resetSimulation(state, events, seq);
  }
});
