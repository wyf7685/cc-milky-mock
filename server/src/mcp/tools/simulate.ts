import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState, SimMessageSegment } from '@/types.js';
import type { EventBus, MilkyEvent } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { getMessageKey } from '@/state/store.js';

const zUin = z.number().int().min(10001).max(4294967295);

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function registerSimulateTools(
  server: McpServer,
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
): void {
  server.registerTool(
    'simulate_message',
    {
      title: '模拟用户发送消息',
      description: '模拟其他用户发送消息，生成 message_receive 事件推送到客户端',
      inputSchema: z.object({
        message_scene: z.enum(['friend', 'group', 'temp']).describe('消息场景'),
        peer_id: zUin.describe('接收方 ID（好友 QQ 号或群号）'),
        sender_id: zUin.describe('发送者 QQ 号'),
        segments: z.array(z.object({
          type: z.string(),
        }).passthrough()).describe('消息段数组，格式同 OutgoingSegment'),
      }),
    },
    async ({ message_scene, peer_id, sender_id, segments }) => {
      const scene = message_scene as 'friend' | 'group' | 'temp';
      const messageSeq = seq.next(`message_seq:scene === 'friend' ? 'friend' : 'group':${peer_id}`);
      const time = now();

      const incomingSegments = await Promise.all(
        (segments as SimMessageSegment[]).map((seg) => convertToIncoming(seg, state)),
      );

      const msg = {
        scene,
        peerId: peer_id,
        messageSeq,
        senderId: sender_id,
        time,
        segments: incomingSegments,
        recalled: false,
      };

      const key = getMessageKey(scene, peer_id);
      if (!state.messages.has(key)) state.messages.set(key, []);
      state.messages.get(key)!.push(msg);

      const baseEvent = {
        time,
        self_id: state.bot.uin,
        event_type: 'message_receive',
      };

      let eventData: object;
      if (scene === 'friend') {
        const user = state.users.get(sender_id);
        eventData = {
          ...baseEvent,
          data: {
            message_scene: 'friend',
            peer_id,
            message_seq: messageSeq,
            sender_id,
            time,
            segments: incomingSegments,
            friend: {
              user_id: sender_id,
              nickname: user?.nickname ?? 'unknown',
              sex: user?.sex ?? 'unknown',
              qid: user?.qid ?? '',
              remark: user?.remark ?? '',
              category: { category_id: 0, category_name: '' },
            },
          },
        };
      } else {
        const group = state.groups.get(peer_id);
        const member = group?.members.get(sender_id);
        eventData = {
          ...baseEvent,
          data: {
            message_scene: 'group',
            peer_id,
            message_seq: messageSeq,
            sender_id,
            time,
            segments: incomingSegments,
            group: group
              ? { group_id: group.groupId, group_name: group.groupName, member_count: group.memberCount, max_member_count: group.maxMemberCount }
              : { group_id: peer_id, group_name: '', member_count: 0, max_member_count: 0 },
            group_member: member
              ? { user_id: member.userId, nickname: member.nickname, sex: member.sex ?? 'unknown', group_id: member.groupId, card: member.card ?? '', title: member.title ?? '', level: member.level ?? 0, role: member.role, join_time: member.joinTime, last_sent_time: member.lastSentTime, shut_up_end_time: member.shutUpEndTime ?? 0 }
              : { user_id: sender_id, nickname: 'unknown', sex: 'unknown', group_id: peer_id, card: '', title: '', level: 0, role: 'member', join_time: 0, last_sent_time: 0, shut_up_end_time: 0 },
          },
        };
      }

      events.emit(eventData as MilkyEvent);
      return {
        content: [{ type: 'text', text: `Message simulated: ${scene} message from ${sender_id} to ${peer_id}, seq=${messageSeq}` }],
      };
    },
  );

  server.registerTool(
    'simulate_friend_request',
    {
      title: '模拟好友请求',
      description: '模拟收到好友请求事件',
      inputSchema: z.object({
        initiator_id: zUin.describe('发起者 QQ 号'),
        comment: z.string().optional().describe('验证消息'),
        via: z.string().optional().describe('来源'),
      }),
    },
    async ({ initiator_id, comment, via }) => {
      const time = now();
      const uid = `uid_${initiator_id}`;
      const req = {
        time,
        initiatorId: initiator_id,
        initiatorUid: uid,
        targetUserId: state.bot.uin,
        targetUserUid: `uid_${state.bot.uin}`,
        state: 'pending' as const,
        comment: comment ?? '',
        via: via ?? '',
        isFiltered: false,
      };
      state.friendRequests.push(req);
      events.emit({
        time,
        self_id: state.bot.uin,
        event_type: 'friend_request',
        data: {
          initiator_id: initiator_id,
          initiator_uid: uid,
          comment: comment ?? '',
          via: via ?? '',
        },
      });
      return {
        content: [{ type: 'text', text: `Friend request simulated from ${initiator_id}` }],
      };
    },
  );

  server.registerTool(
    'simulate_group_join_request',
    {
      title: '模拟入群申请',
      description: '模拟收到入群申请事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        initiator_id: zUin.describe('申请人 QQ 号'),
        comment: z.string().optional().describe('验证消息'),
      }),
    },
    async ({ group_id, initiator_id, comment }) => {
      const time = now();
      const notifSeq = seq.next(`notification_seq:group:${group_id}`);
      const notif = {
        type: 'join_request' as const,
        groupId: group_id,
        notificationSeq: notifSeq,
        isFiltered: false,
        initiatorId: initiator_id,
        state: 'pending' as const,
        comment: comment ?? '',
      };
      if (!state.groupNotifications.has(group_id)) state.groupNotifications.set(group_id, []);
      state.groupNotifications.get(group_id)!.push(notif);
      events.emit({
        time,
        self_id: state.bot.uin,
        event_type: 'group_join_request',
        data: {
          group_id,
          notification_seq: notifSeq,
          is_filtered: false,
          initiator_id,
          comment: comment ?? '',
        },
      });
      return {
        content: [{ type: 'text', text: `Group join request simulated: user ${initiator_id} -> group ${group_id}` }],
      };
    },
  );

  server.registerTool(
    'simulate_group_invitation',
    {
      title: '模拟群邀请',
      description: '模拟收到群邀请事件',
      inputSchema: z.object({
        group_id: zUin.describe('目标群号'),
        initiator_id: zUin.describe('邀请者 QQ 号'),
      }),
    },
    async ({ group_id, initiator_id }) => {
      const time = now();
      const invSeq = seq.next(`invitation_seq:${group_id}`);
      state.groupInvitations.push({
        groupId: group_id,
        invitationSeq: invSeq,
        initiatorId: initiator_id,
      });
      events.emit({
        time,
        self_id: state.bot.uin,
        event_type: 'group_invitation',
        data: {
          group_id,
          invitation_seq: invSeq,
          initiator_id,
        },
      });
      return {
        content: [{ type: 'text', text: `Group invitation simulated: user ${initiator_id} invited bot to group ${group_id}` }],
      };
    },
  );

  server.registerTool(
    'simulate_message_recall',
    {
      title: '模拟消息撤回',
      description: '模拟用户撤回消息事件',
      inputSchema: z.object({
        message_scene: z.enum(['friend', 'group', 'temp']).describe('消息场景'),
        peer_id: zUin.describe('会话 ID'),
        message_seq: z.number().int().describe('被撤回的消息序号'),
        sender_id: zUin.describe('原发送者 QQ 号'),
        operator_id: zUin.optional().describe('操作者 QQ 号（默认同 sender_id）'),
      }),
    },
    async ({ message_scene, peer_id, message_seq, sender_id, operator_id }) => {
      const key = getMessageKey(message_scene, peer_id);
      const msgs = state.messages.get(key);
      const msg = msgs?.find((m) => m.messageSeq === message_seq);
      if (msg) msg.recalled = true;
      events.emit({
        time: now(),
        self_id: state.bot.uin,
        event_type: 'message_recall',
        data: {
          message_scene,
          peer_id,
          message_seq,
          sender_id,
          operator_id: operator_id ?? sender_id,
          display_suffix: '撤回了一条消息',
        },
      });
      return {
        content: [{ type: 'text', text: `Message recall simulated: seq=${message_seq} in ${message_scene}:${peer_id}` }],
      };
    },
  );

  server.registerTool(
    'simulate_group_member_increase',
    {
      title: '模拟成员入群',
      description: '模拟群成员增加事件（自动添加成员到群组）',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('新成员 QQ 号'),
        operator_id: zUin.optional().describe('操作者 QQ 号'),
        invitor_id: zUin.optional().describe('邀请者 QQ 号'),
      }),
    },
    async ({ group_id, user_id, operator_id, invitor_id }) => {
      const group = state.groups.get(group_id);
      if (!group) return { content: [{ type: 'text', text: `Error: Group ${group_id} not found` }], isError: true };
      const user = state.users.get(user_id);
      if (!user) return { content: [{ type: 'text', text: `Error: User ${user_id} not found` }], isError: true };
      const t = now();
      group.members.set(user_id, {
        userId: user_id, nickname: user.nickname, sex: user.sex, groupId: group_id,
        card: '', title: '', level: 1, role: 'member', joinTime: t, lastSentTime: t,
      });
      group.memberCount = group.members.size;
      events.emit({
        time: t, self_id: state.bot.uin, event_type: 'group_member_increase',
        data: { group_id, user_id, operator_id, invitor_id },
      });
      return { content: [{ type: 'text', text: `Member increase simulated: user ${user_id} joined group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_member_decrease',
    {
      title: '模拟成员退群',
      description: '模拟群成员减少事件（自动从群组移除成员）',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('退群者 QQ 号'),
        operator_id: zUin.optional().describe('操作者 QQ 号（被踢时）'),
      }),
    },
    async ({ group_id, user_id, operator_id }) => {
      const group = state.groups.get(group_id);
      if (!group) return { content: [{ type: 'text', text: `Error: Group ${group_id} not found` }], isError: true };
      group.members.delete(user_id);
      group.memberCount = group.members.size;
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_member_decrease',
        data: { group_id, user_id, operator_id },
      });
      return { content: [{ type: 'text', text: `Member decrease simulated: user ${user_id} left group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_name_change',
    {
      title: '模拟群名变更',
      description: '模拟群名称变更事件（自动更新群名）',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        new_group_name: z.string().describe('新群名'),
        operator_id: zUin.describe('操作者 QQ 号'),
      }),
    },
    async ({ group_id, new_group_name, operator_id }) => {
      const group = state.groups.get(group_id);
      if (!group) return { content: [{ type: 'text', text: `Error: Group ${group_id} not found` }], isError: true };
      group.groupName = new_group_name;
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_name_change',
        data: { group_id, new_group_name, operator_id },
      });
      return { content: [{ type: 'text', text: `Group name change simulated: group ${group_id} renamed to "${new_group_name}"` }] };
    },
  );

  server.registerTool(
    'simulate_group_mute',
    {
      title: '模拟群禁言',
      description: '模拟群成员禁言事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('被禁言者 QQ 号'),
        operator_id: zUin.describe('操作者 QQ 号'),
        duration: z.number().int().describe('禁言时长（秒）'),
      }),
    },
    async ({ group_id, user_id, operator_id, duration }) => {
      const group = state.groups.get(group_id);
      if (!group) return { content: [{ type: 'text', text: `Error: Group ${group_id} not found` }], isError: true };
      const member = group.members.get(user_id);
      if (member) member.shutUpEndTime = now() + duration;
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_mute',
        data: { group_id, user_id, operator_id, duration },
      });
      return { content: [{ type: 'text', text: `Group mute simulated: user ${user_id} muted for ${duration}s in group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_friend_nudge',
    {
      title: '模拟好友戳一戳',
      description: '模拟好友戳一戳事件',
      inputSchema: z.object({
        user_id: zUin.describe('对方 QQ 号'),
        display_action: z.string().optional().describe('显示动作'),
        display_suffix: z.string().optional().describe('显示后缀'),
      }),
    },
    async ({ user_id, display_action, display_suffix }) => {
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'friend_nudge',
        data: {
          user_id,
          is_self_send: false,
          is_self_receive: true,
          display_action: display_action ?? '戳了戳',
          display_suffix: display_suffix ?? '',
          display_action_img_url: '',
        },
      });
      return { content: [{ type: 'text', text: `Friend nudge simulated from user ${user_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_nudge',
    {
      title: '模拟群戳一戳',
      description: '模拟群内戳一戳事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        sender_id: zUin.describe('发送者 QQ 号'),
        receiver_id: zUin.describe('接收者 QQ 号'),
        display_action: z.string().optional().describe('显示动作'),
        display_suffix: z.string().optional().describe('显示后缀'),
      }),
    },
    async ({ group_id, sender_id, receiver_id, display_action, display_suffix }) => {
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_nudge',
        data: {
          group_id,
          sender_id,
          receiver_id,
          display_action: display_action ?? '戳了戳',
          display_suffix: display_suffix ?? '',
          display_action_img_url: '',
        },
      });
      return { content: [{ type: 'text', text: `Group nudge simulated: ${sender_id} -> ${receiver_id} in group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_friend_file_upload',
    {
      title: '模拟好友文件上传',
      description: '模拟好友上传文件事件',
      inputSchema: z.object({
        user_id: zUin.describe('上传者 QQ 号'),
        file_name: z.string().describe('文件名'),
        file_size: z.number().int().describe('文件大小（字节）'),
      }),
    },
    async ({ user_id, file_name, file_size }) => {
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'friend_file_upload',
        data: {
          user_id,
          file_id: `f_${Date.now()}`,
          file_name,
          file_size,
          file_hash: '',
          is_self: false,
        },
      });
      return { content: [{ type: 'text', text: `Friend file upload simulated: ${file_name} from user ${user_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_file_upload',
    {
      title: '模拟群文件上传',
      description: '模拟群内文件上传事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('上传者 QQ 号'),
        file_name: z.string().describe('文件名'),
        file_size: z.number().int().describe('文件大小（字节）'),
      }),
    },
    async ({ group_id, user_id, file_name, file_size }) => {
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_file_upload',
        data: {
          group_id,
          user_id,
          file_id: `gf_${Date.now()}`,
          file_name,
          file_size,
        },
      });
      return { content: [{ type: 'text', text: `Group file upload simulated: ${file_name} by user ${user_id} in group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_invited_join_request',
    {
      title: '模拟邀请入群请求',
      description: '模拟群成员邀请他人入群请求事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        initiator_id: zUin.describe('邀请者 QQ 号'),
        target_user_id: zUin.describe('被邀请者 QQ 号'),
      }),
    },
    async ({ group_id, initiator_id, target_user_id }) => {
      const time = now();
      const notifSeq = seq.next(`notification_seq:group:${group_id}`);
      if (!state.groupNotifications.has(group_id)) state.groupNotifications.set(group_id, []);
      state.groupNotifications.get(group_id)!.push({
        type: 'invited_join_request',
        groupId: group_id,
        notificationSeq: notifSeq,
        initiatorId: initiator_id,
        targetUserId: target_user_id,
        state: 'pending',
      });
      events.emit({
        time, self_id: state.bot.uin, event_type: 'group_invited_join_request',
        data: { group_id, notification_seq: notifSeq, initiator_id, target_user_id },
      });
      return { content: [{ type: 'text', text: `Invited join request simulated: ${initiator_id} invited ${target_user_id} to group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_admin_change',
    {
      title: '模拟管理员变更',
      description: '模拟群管理员变更事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('发生变更的用户 QQ 号'),
        operator_id: zUin.describe('操作者 QQ 号'),
        is_set: z.boolean().default(true).describe('是否设置为管理员，false 表示取消'),
      }),
    },
    async ({ group_id, user_id, operator_id, is_set }) => {
      const group = state.groups.get(group_id);
      if (group) {
        const member = group.members.get(user_id);
        if (member) member.role = is_set !== false ? 'admin' : 'member';
      }
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_admin_change',
        data: { group_id, user_id, operator_id, is_set: is_set !== false },
      });
      return { content: [{ type: 'text', text: `Admin change simulated: user ${user_id} ${is_set !== false ? 'promoted to' : 'demoted from'} admin in group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_essence_message_change',
    {
      title: '模拟精华消息变更',
      description: '模拟群精华消息变更事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        message_seq: z.number().int().describe('消息序列号'),
        operator_id: zUin.describe('操作者 QQ 号'),
        is_set: z.boolean().default(true).describe('是否设置为精华，false 表示取消'),
      }),
    },
    async ({ group_id, message_seq, operator_id, is_set }) => {
      if (!state.groupEssenceMessages.has(group_id)) state.groupEssenceMessages.set(group_id, new Set());
      const essSet = state.groupEssenceMessages.get(group_id)!;
      if (is_set !== false) essSet.add(message_seq); else essSet.delete(message_seq);
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_essence_message_change',
        data: { group_id, message_seq, operator_id, is_set: is_set !== false },
      });
      return { content: [{ type: 'text', text: `Essence message change: seq=${message_seq} in group ${group_id} ${is_set !== false ? 'set as' : 'removed from'} essence` }] };
    },
  );

  server.registerTool(
    'simulate_group_message_reaction',
    {
      title: '模拟群消息表情回应',
      description: '模拟群消息表情回应事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        user_id: zUin.describe('发送回应者 QQ 号'),
        message_seq: z.number().int().describe('消息序列号'),
        face_id: z.string().describe('表情 ID'),
        reaction_type: z.enum(['face', 'emoji']).default('face').describe('回应类型'),
        is_add: z.boolean().default(true).describe('是否添加，false 表示取消'),
      }),
    },
    async ({ group_id, user_id, message_seq, face_id, reaction_type, is_add }) => {
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_message_reaction',
        data: { group_id, user_id, message_seq, face_id, reaction_type: reaction_type ?? 'face', is_add: is_add !== false },
      });
      return { content: [{ type: 'text', text: `Message reaction: user ${user_id} ${is_add !== false ? 'added' : 'removed'} ${face_id} on seq=${message_seq} in group ${group_id}` }] };
    },
  );

  server.registerTool(
    'simulate_group_whole_mute',
    {
      title: '模拟群全体禁言',
      description: '模拟群全体禁言事件',
      inputSchema: z.object({
        group_id: zUin.describe('群号'),
        operator_id: zUin.describe('操作者 QQ 号'),
        is_mute: z.boolean().default(true).describe('是否全员禁言，false 表示取消'),
      }),
    },
    async ({ group_id, operator_id, is_mute }) => {
      const group = state.groups.get(group_id);
      if (group) group.wholeMuted = is_mute !== false;
      events.emit({
        time: now(), self_id: state.bot.uin, event_type: 'group_whole_mute',
        data: { group_id, operator_id, is_mute: is_mute !== false },
      });
      return { content: [{ type: 'text', text: `Whole mute simulated: group ${group_id} ${is_mute !== false ? 'muted' : 'unmuted'} by ${operator_id}` }] };
    },
  );
}

async function convertToIncoming(seg: SimMessageSegment, state: SimState): Promise<SimMessageSegment> {
  // Accept both {type, data: {...}} and {type, ...fields} input formats
  const fields: Record<string, unknown> = (seg.data && typeof seg.data === 'object')
    ? seg.data as Record<string, unknown>
    : (() => { const { type: _, ...rest } = seg; return rest; })();

  const type = seg.type as string;

  switch (type) {
    case 'text':
    case 'mention':
    case 'mention_all':
    case 'face':
      return { type, data: fields };
    case 'reply':
      return { type, data: { message_seq: fields.message_seq } };
    case 'image': {
      const uri = fields.uri as string | undefined;
      if (!uri) {
        return { type, data: { resource_id: `res_${Date.now()}`, temp_url: '', width: 0, height: 0, summary: '[图片]', sub_type: 'normal' } };
      }
      const entry = await state.resourceStore.resolveAndStore(uri, {
        subType: fields.sub_type as string | undefined,
        summary: fields.summary as string | undefined,
      });
      return {
        type,
        data: {
          resource_id: entry.resourceId,
          temp_url: `/resources/${entry.resourceId}`,
          width: entry.width,
          height: entry.height,
          summary: entry.summary,
          sub_type: entry.subType,
        },
      };
    }
    case 'record':
      return { type, data: { resource_id: `res_${Date.now()}`, temp_url: '', duration: 0 } };
    case 'video':
      return { type, data: { resource_id: `res_${Date.now()}`, temp_url: '', width: 0, height: 0, duration: 0 } };
    default:
      return { type, data: fields };
  }
}
