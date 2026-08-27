import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { ActivityLog, ActivityQuery } from '@/state/activity.js';

const zUin = z.number().int().min(10001).max(4294967295);
const zActivityType = z.enum(['event', 'message', 'api_call', 'connection']);

export function registerInspectTools(
  server: McpServer,
  state: SimState,
  events: EventBus,
  activity: ActivityLog,
): void {
  server.registerTool(
    'get_activity',
    {
      title: '查询或等待模拟活动',
      description: '按统一游标增量查询事件、Bot 出站消息、API 调用和连接变化。wait_timeout_ms 大于 0 时会等待首个匹配活动，避免轮询。',
      inputSchema: z.object({
        after_cursor: z.number().int().min(0).optional().describe('仅返回此游标之后的活动；不传且等待时只监听新活动'),
        type: z.array(zActivityType).optional().describe('活动类型过滤，默认全部'),
        limit: z.number().int().min(1).max(200).optional().default(20).describe('最大返回条数'),
        wait_timeout_ms: z.number().int().min(0).max(30000).optional().default(0).describe('等待匹配活动的最长毫秒数；0 表示立即返回'),
        message_scene: z.enum(['friend', 'group', 'temp']).optional().describe('会话场景过滤，统一作用于可解析的活动'),
        peer_id: zUin.optional().describe('会话 ID 过滤，统一作用于可解析的活动'),
        sender_id: zUin.optional().describe('发送者 QQ 号过滤'),
        event_type: z.string().optional().describe('事件名称精确过滤'),
        api: z.string().optional().describe('API 名称精确过滤'),
        text_contains: z.string().optional().describe('按提取后的 plain_text 包含匹配'),
        include_state: z.boolean().optional().default(false).describe('是否同时返回环境摘要'),
      }),
    },
    async ({ after_cursor, type, limit, wait_timeout_ms, message_scene, peer_id, sender_id, event_type, api, text_contains, include_state }) => {
      const query: ActivityQuery = {
        afterCursor: after_cursor,
        limit: limit ?? 20,
        types: type,
        messageScene: message_scene,
        peerId: peer_id,
        senderId: sender_id,
        eventType: event_type,
        api,
        textContains: text_contains,
      };
      const waitMs = wait_timeout_ms ?? 0;
      const result = waitMs > 0
        ? await activity.wait(query, waitMs)
        : { ...activity.query(query), timedOut: false };

      const response: Record<string, unknown> = {
        activities: result.activities,
        next_cursor: result.nextCursor,
        current_cursor: result.currentCursor,
        oldest_cursor: result.oldestCursor,
        truncated: result.truncated,
        timed_out: result.timedOut,
      };
      if (include_state) {
        response.state = {
          bot: state.bot,
          users: state.users.size,
          friends: state.friends.size,
          groups: [...state.groups.entries()].map(([id, group]) => ({
            group_id: id,
            group_name: group.groupName,
            member_count: group.memberCount,
            whole_muted: group.wholeMuted,
          })),
          total_messages: [...state.messages.values()].reduce((sum, messages) => sum + messages.length, 0),
          friend_requests: state.friendRequests.length,
          pinned_peers: [...state.pinnedPeers],
          connections: events.getConnectionCount(),
        };
      }

      return { content: [{ type: 'text', text: JSON.stringify(response) }] };
    },
  );

  server.registerTool(
    'clear_activity',
    {
      title: '清空活动记录',
      description: '清空活动历史但保留实体、服务器和连接；游标继续单调递增。',
      inputSchema: z.object({}),
    },
    async () => {
      activity.clear();
      return {
        content: [{ type: 'text', text: JSON.stringify({ cleared: true, current_cursor: activity.currentCursor() }) }],
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
