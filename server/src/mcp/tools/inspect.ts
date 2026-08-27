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
      description: '按游标查询或等待入站事件、Bot 出站消息、API 调用和连接变化。默认返回 cursor、type、time、会话标识和 plain_text 等摘要，next_cursor 用于续查；检查消息段、原始事件、API 参数或连接详情时设置 include_data=true。',
      inputSchema: z.object({
        after_cursor: z.number().int().min(0).optional().describe('仅返回此游标之后的活动；通常传上次结果的 next_cursor；不传且等待时只监听新活动'),
        type: z.array(zActivityType).optional().describe('活动类型过滤，默认全部'),
        limit: z.number().int().min(1).max(200).optional().default(20).describe('最多返回条数，默认 20，最大 200'),
        wait_timeout_ms: z.number().int().min(0).max(30000).optional().default(0).describe('等待首个匹配活动的毫秒数，默认 0（立即返回），最大 30000'),
        message_scene: z.enum(['friend', 'group', 'temp']).optional().describe('按 friend/group/temp 会话场景过滤'),
        peer_id: zUin.optional().describe('按会话 ID 过滤'),
        sender_id: zUin.optional().describe('按发送者 QQ 号过滤'),
        event_type: z.string().optional().describe('按事件名称精确过滤'),
        api: z.string().optional().describe('按 API 名称精确过滤'),
        text_contains: z.string().optional().describe('按摘要字段 plain_text 做包含匹配'),
        include_data: z.boolean().optional().default(false).describe('附带完整原始 data，默认 false。普通文本检查使用 plain_text；检查消息 segments、事件载荷、API params/error 或连接 action/count 时开启'),
        include_state: z.boolean().optional().default(false).describe('附带 Bot、实体数量、群摘要和连接数，默认 false'),
      }),
    },
    async ({ after_cursor, type, limit, wait_timeout_ms, message_scene, peer_id, sender_id, event_type, api, text_contains, include_data, include_state }) => {
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

      const activities = include_data
        ? result.activities
        : result.activities.map(({ data: _data, ...summary }) => summary);
      const response: Record<string, unknown> = {
        activities,
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
      description: '清空活动历史，保留实体、消息、服务器和连接；游标不归零，查询已清除范围内的旧游标会返回 truncated=true。',
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
      description: '返回图片 resource_id 对应的本地文件路径和元数据；resource_id 来自消息段，使用 Read 查看内容。',
      inputSchema: z.object({
        resource_id: z.string().describe('图片消息段中的资源 ID'),
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
