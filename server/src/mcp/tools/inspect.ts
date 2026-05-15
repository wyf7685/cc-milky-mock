import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';

const zUin = z.number().int().min(10001).max(4294967295);
const zActivityType = z.enum(['state', 'messages', 'events', 'api_calls']);

export function registerInspectTools(
  server: McpServer,
  state: SimState,
  events: EventBus,
): void {
  server.registerTool(
    'get_activity',
    {
      title: '查看模拟活动',
      description: '查看模拟环境的状态、消息记录、事件日志和 API 调用记录。可通过 type 数组选择需要的内容。',
      inputSchema: z.object({
        type: z.array(zActivityType).optional().default(['state', 'messages', 'events', 'api_calls']).describe('要获取的数据类型数组'),
        limit: z.number().int().optional().default(20).describe('消息/事件/API 调用的最大返回条数'),
        message_scene: z.enum(['friend', 'group', 'temp']).optional().describe('按场景过滤消息'),
        peer_id: zUin.optional().describe('按会话 ID 过滤消息'),
      }),
    },
    async ({ type, limit, message_scene, peer_id }) => {
      const types = type ?? ['state', 'messages', 'events', 'api_calls'];
      const result: Record<string, unknown> = {};
      const n = limit ?? 20;

      if (types.includes('state')) {
        result.state = {
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
      }

      if (types.includes('messages')) {
        let msgs = [...state.clientSentMessages];
        if (message_scene) msgs = msgs.filter((m) => m.scene === message_scene);
        if (peer_id != null) msgs = msgs.filter((m) => m.peerId === peer_id);
        result.messages = msgs.slice(-n);
      }

      if (types.includes('events')) {
        result.events = events.getRecentEvents(n);
      }

      if (types.includes('api_calls')) {
        result.api_calls = state.clientApiCalls.slice(-n);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
