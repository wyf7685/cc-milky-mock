import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { startServer } from './server.js';

const zUin = z.number().int().min(10001).max(4294967295);

export function registerEnvTools(
  server: McpServer,
  state: SimState,
  events?: EventBus,
  seq?: SequenceGenerator,
): void {
  server.registerTool(
    'set_bot_info',
    {
      title: '设置机器人信息',
      description: '设置模拟机器人的 QQ 号和昵称',
      inputSchema: z.object({
        uin: zUin.describe('机器人 QQ 号'),
        nickname: z.string().describe('机器人昵称'),
        bio: z.string().optional().describe('个性签名'),
      }),
    },
    async ({ uin, nickname, bio }) => {
      state.bot.uin = uin;
      state.bot.nickname = nickname;
      if (bio !== undefined) state.bot.bio = bio;
      return {
        content: [{ type: 'text', text: `Bot set to ${nickname} (${uin})` }],
      };
    },
  );

  server.registerTool(
    'create_user',
    {
      title: '创建模拟用户',
      description: '在模拟环境中创建一个用户',
      inputSchema: z.object({
        user_id: zUin.describe('用户 QQ 号'),
        nickname: z.string().describe('用户昵称'),
        sex: z.enum(['male', 'female', 'unknown']).optional().describe('性别'),
        remark: z.string().optional().describe('备注名'),
        qid: z.string().optional().describe('QID'),
        age: z.number().int().optional().describe('年龄'),
        bio: z.string().optional().describe('个性签名'),
      }),
    },
    async ({ user_id, nickname, sex, remark, qid, age, bio }) => {
      state.users.set(user_id, {
        userId: user_id,
        nickname,
        sex,
        remark,
        qid,
        age,
        bio,
      });
      return {
        content: [{ type: 'text', text: `User ${nickname} (${user_id}) created` }],
      };
    },
  );

  server.registerTool(
    'create_friend',
    {
      title: '创建好友关系',
      description: '将已存在的用户添加为好友',
      inputSchema: z.object({
        user_id: zUin.describe('好友 QQ 号'),
      }),
    },
    async ({ user_id }) => {
      if (!state.users.has(user_id)) {
        return {
          content: [{ type: 'text', text: `Error: User ${user_id} not found. Create the user first.` }],
          isError: true,
        };
      }
      state.friends.add(`${state.bot.uin}:${user_id}`);
      return {
        content: [{ type: 'text', text: `Friend relationship created with user ${user_id}` }],
      };
    },
  );

  server.registerTool(
    'create_group',
    {
      title: '创建模拟群组',
      description: '在模拟环境中创建一个群组',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        group_name: z.string().describe('群名称'),
        max_member_count: z.number().int().optional().describe('最大成员数'),
      }),
    },
    async ({ group_id, group_name, max_member_count }) => {
      state.groups.set(group_id, {
        groupId: group_id,
        groupName: group_name,
        memberCount: 0,
        maxMemberCount: max_member_count ?? 500,
        members: new Map(),
        wholeMuted: false,
      });
      return {
        content: [{ type: 'text', text: `Group ${group_name} (${group_id}) created` }],
      };
    },
  );

  server.registerTool(
    'add_group_member',
    {
      title: '添加群成员',
      description: '将已存在的用户添加到群组',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('用户 QQ 号'),
        role: z.enum(['owner', 'admin', 'member']).optional().describe('群内角色'),
        card: z.string().optional().describe('群名片'),
      }),
    },
    async ({ group_id, user_id, role, card }) => {
      const group = state.groups.get(group_id);
      if (!group) {
        return {
          content: [{ type: 'text', text: `Error: Group ${group_id} not found` }],
          isError: true,
        };
      }
      const user = state.users.get(user_id);
      if (!user) {
        return {
          content: [{ type: 'text', text: `Error: User ${user_id} not found. Create the user first.` }],
          isError: true,
        };
      }
      const now = Math.floor(Date.now() / 1000);
      group.members.set(user_id, {
        userId: user_id,
        nickname: user.nickname,
        sex: user.sex,
        groupId: group_id,
        card: card ?? '',
        title: '',
        level: 1,
        role: role ?? 'member',
        joinTime: now,
        lastSentTime: now,
      });
      group.memberCount = group.members.size;
      return {
        content: [{ type: 'text', text: `User ${user.nickname} (${user_id}) added to group ${group.groupName} (${group_id}) as ${role ?? 'member'}` }],
      };
    },
  );

  server.registerTool(
    'remove_group_member',
    {
      title: '移除群成员',
      description: '从群组中移除用户',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('用户 QQ 号'),
      }),
    },
    async ({ group_id, user_id }) => {
      const group = state.groups.get(group_id);
      if (!group) {
        return { content: [{ type: 'text', text: `Error: Group ${group_id} not found` }], isError: true };
      }
      if (!group.members.has(user_id)) {
        return { content: [{ type: 'text', text: `Error: User ${user_id} is not in group ${group_id}` }], isError: true };
      }
      group.members.delete(user_id);
      group.memberCount = group.members.size;
      return {
        content: [{ type: 'text', text: `User ${user_id} removed from group ${group_id}` }],
      };
    },
  );

  server.registerTool(
    'set_group_member_role',
    {
      title: '设置群成员角色',
      description: '修改群成员的角色（群主/管理员/普通成员）',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('用户 QQ 号'),
        role: z.enum(['owner', 'admin', 'member']).describe('新角色'),
      }),
    },
    async ({ group_id, user_id, role }) => {
      const group = state.groups.get(group_id);
      if (!group) {
        return { content: [{ type: 'text', text: `Error: Group ${group_id} not found` }], isError: true };
      }
      const member = group.members.get(user_id);
      if (!member) {
        return { content: [{ type: 'text', text: `Error: User ${user_id} is not in group ${group_id}` }], isError: true };
      }
      member.role = role;
      return {
        content: [{ type: 'text', text: `User ${user_id} role changed to ${role} in group ${group_id}` }],
      };
    },
  );

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
        const group = state.groups.get(g.group_id)!;
        const now = Math.floor(Date.now() / 1000);
        for (const m of g.members ?? []) {
          if (group.members.has(m.user_id)) continue;
          const user = state.users.get(m.user_id);
          if (!user) {
            created.push(`WARN: user ${m.user_id} not found, skipped adding to group ${g.group_id}`);
            continue;
          }
          group.members.set(m.user_id, {
            userId: m.user_id,
            nickname: user.nickname,
            sex: user.sex,
            groupId: g.group_id,
            card: m.card ?? '',
            title: '',
            level: 1,
            role: m.role ?? 'member',
            joinTime: now,
            lastSentTime: now,
          });
          created.push(`member: ${user.nickname} (${m.user_id}) -> group ${g.group_id} as ${m.role ?? 'member'}`);
        }
        group.memberCount = group.members.size;
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
