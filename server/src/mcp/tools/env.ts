import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { createMember } from '@/utils/state.js';
import { startServer } from './server.js';

const zUin = z.number().int().min(10001).max(4294967295);

export function registerEnvTools(
  server: McpServer,
  state: SimState,
  events?: EventBus,
  seq?: SequenceGenerator,
): void {
  server.registerTool(
    'init_test_env',
    {
      title: '批量初始化测试环境',
      description: '一次性设置机器人信息、创建用户、群组、成员关系和好友关系。跳过已存在的实体，不会重复创建。',
      inputSchema: z.object({
        bot: z.object({
          uin: zUin.describe('机器人 QQ 号'),
          nickname: z.string().describe('机器人昵称'),
          bio: z.string().optional().describe('个性签名'),
        }).optional().describe('机器人信息'),
        users: z.array(z.object({
          user_id: zUin.describe('用户 QQ 号'),
          nickname: z.string().describe('用户昵称'),
          sex: z.enum(['male', 'female', 'unknown']).optional(),
          remark: z.string().optional(),
          qid: z.string().optional(),
          age: z.number().int().optional(),
          bio: z.string().optional(),
        })).optional().default([]).describe('要创建的用户列表'),
        groups: z.array(z.object({
          group_id: zUin.describe('群号'),
          group_name: z.string().describe('群名称'),
          max_member_count: z.number().int().optional(),
          members: z.array(z.object({
            user_id: zUin.describe('成员 QQ 号'),
            role: z.enum(['owner', 'admin', 'member']).optional().default('member'),
            card: z.string().optional(),
          })).optional().default([]).describe('群成员列表（用户需已创建）'),
        })).optional().default([]).describe('要创建的群组列表'),
        friends: z.array(zUin).optional().default([]).describe('要添加为好友的用户 QQ 号列表'),
        start_server: z.boolean().optional().default(false).describe('初始化完成后是否启动 HTTP 服务器'),
        port: z.number().int().min(1).max(65535).optional().default(3000).describe('HTTP 服务器端口'),
        access_token: z.string().optional().default('milky-mock-token').describe('Bearer access token'),
      }),
    },
    async ({ bot, users, groups, friends, start_server, port, access_token }) => {
      const created: string[] = [];

      if (bot) {
        state.bot.uin = bot.uin;
        state.bot.nickname = bot.nickname;
        if (bot.bio !== undefined) state.bot.bio = bot.bio;
        created.push(`bot: ${bot.nickname} (${bot.uin})`);
      }

      for (const u of users ?? []) {
        if (state.users.has(u.user_id)) continue;
        state.users.set(u.user_id, {
          userId: u.user_id,
          nickname: u.nickname,
          sex: u.sex,
          remark: u.remark,
          qid: u.qid,
          age: u.age,
          bio: u.bio,
        });
        created.push(`user: ${u.nickname} (${u.user_id})`);
      }

      for (const g of groups ?? []) {
        if (!state.groups.has(g.group_id)) {
          state.groups.set(g.group_id, {
            groupId: g.group_id,
            groupName: g.group_name,
            memberCount: 0,
            maxMemberCount: g.max_member_count ?? 500,
            members: new Map(),
            wholeMuted: false,
          });
          created.push(`group: ${g.group_name} (${g.group_id})`);
        }
        for (const m of g.members ?? []) {
          if (state.groups.get(g.group_id)!.members.has(m.user_id)) continue;
          const result = createMember(state, g.group_id, m.user_id, { role: m.role, card: m.card });
          if (result.ok) {
            const user = state.users.get(m.user_id)!;
            created.push(`member: ${user.nickname} (${m.user_id}) -> group ${g.group_id} as ${m.role ?? 'member'}`);
          } else {
            created.push(`WARN: ${result.error}`);
          }
        }
      }

      for (const uid of friends ?? []) {
        const key = `${state.bot.uin}:${uid}`;
        if (state.friends.has(key)) continue;
        if (!state.users.has(uid)) {
          created.push(`WARN: user ${uid} not found, skipped friend`);
          continue;
        }
        state.friends.add(key);
        created.push(`friend: ${uid}`);
      }

      if (start_server && events && seq) {
        try {
          const serverMsg = await startServer(port ?? 3000, access_token ?? 'milky-mock-token', state, events, seq);
          created.push(`\n${serverMsg}`);
        } catch (err) {
          created.push(`\nWARN: Failed to start server: ${(err as Error).message}`);
        }
      }

      return {
        content: [{ type: 'text', text: created.length > 0 ? created.join('\n') : 'Nothing to create (all entities already exist)' }],
      };
    },
  );
}
