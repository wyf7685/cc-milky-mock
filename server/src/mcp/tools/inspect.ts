import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';

const zUin = z.number().int().min(10001).max(4294967295);

export function registerInspectTools(
  server: McpServer,
  state: SimState,
  events: EventBus,
): void {
  server.registerTool(
    'get_sent_messages',
    {
      title: '查看客户端发送的消息',
      description: '查看 milky 客户端通过 mock 服务器发送的消息记录',
      inputSchema: z.object({
        limit: z.number().int().optional().default(20).describe('返回条数'),
        message_scene: z.enum(['friend', 'group', 'temp']).optional().describe('按场景过滤'),
        peer_id: zUin.optional().describe('按会话 ID 过滤'),
      }),
    },
    async ({ limit, message_scene, peer_id }) => {
      let msgs = [...state.clientSentMessages];
      if (message_scene) msgs = msgs.filter((m) => m.scene === message_scene);
      if (peer_id != null) msgs = msgs.filter((m) => m.peerId === peer_id);
      msgs = msgs.slice(-(limit ?? 20));
      return {
        content: [{ type: 'text', text: JSON.stringify(msgs, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_state',
    {
      title: '查看模拟环境状态',
      description: '返回当前模拟环境的状态摘要',
      inputSchema: z.object({}),
    },
    async () => {
      const summary = {
        bot: state.bot,
        users: state.users.size,
        friends: state.friends.size,
        groups: [...state.groups.entries()].map(([id, g]) => ({
          group_id: id,
          group_name: g.groupName,
          member_count: g.memberCount,
          whole_muted: g.wholeMuted,
        })),
        total_messages: [...state.messages.values()].reduce((sum, msgs) => sum + msgs.length, 0),
        client_sent_messages: state.clientSentMessages.length,
        friend_requests: state.friendRequests.length,
        pinned_peers: [...state.pinnedPeers],
        connections: events.getConnectionCount(),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_event_log',
    {
      title: '查看事件日志',
      description: '查看最近发出的事件记录',
      inputSchema: z.object({
        limit: z.number().int().optional().default(50).describe('返回条数'),
      }),
    },
    async ({ limit }) => {
      const log = events.getRecentEvents(limit ?? 50);
      return {
        content: [{ type: 'text', text: JSON.stringify(log, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_image_data',
    {
      title: '获取图片资源',
      description: '获取图片资源的本地文件路径，可用 Read 工具查看图片内容',
      inputSchema: z.object({
        resource_id: z.string().describe('资源 ID'),
      }),
    },
    async ({ resource_id }) => {
      const filePath = state.resourceStore.getFilePath(resource_id);
      if (!filePath) {
        return { content: [{ type: 'text', text: `Resource ${resource_id} not found` }], isError: true };
      }
      const entry = state.resourceStore.getEntry(resource_id);
      return {
        content: [{
          type: 'text',
          text: [
            `file: ${filePath}`,
            `size: ${entry?.width}x${entry?.height}`,
            `type: ${entry?.subType}`,
            `summary: ${entry?.summary}`,
          ].join('\n'),
        }],
      };
    },
  );
}
