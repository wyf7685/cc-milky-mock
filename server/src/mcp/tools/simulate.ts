import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimState, SimMessageSegment } from '@/types.js';
import type { EventBus, MilkyEvent } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { getMessageKey } from '@/state/store.js';
import { createMember, deleteMember, setMemberRole } from '@/utils/state.js';

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
      const messageSeq = seq.next(`message_seq:${scene === 'friend' ? 'friend' : 'group'}:${peer_id}`);
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

      const baseEvent = { time, self_id: state.bot.uin, event_type: 'message_receive' };

      let eventData: object;
      if (scene === 'friend') {
        const user = state.users.get(sender_id);
        eventData = {
          ...baseEvent,
          data: {
            message_scene: 'friend', peer_id, message_seq: messageSeq, sender_id, time,
            segments: incomingSegments,
            friend: {
              user_id: sender_id, nickname: user?.nickname ?? 'unknown', sex: user?.sex ?? 'unknown',
              qid: user?.qid ?? '', remark: user?.remark ?? '',
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
            message_scene: 'group', peer_id, message_seq: messageSeq, sender_id, time,
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
      return { content: [{ type: 'text', text: `Message simulated: ${scene} message from ${sender_id} to ${peer_id}, seq=${messageSeq}` }] };
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
        time: now(), self_id: state.bot.uin, event_type: 'message_recall',
        data: { message_scene, peer_id, message_seq, sender_id, operator_id: operator_id ?? sender_id, display_suffix: '撤回了一条消息' },
      });
      return { content: [{ type: 'text', text: `Message recall simulated: seq=${message_seq} in ${message_scene}:${peer_id}` }] };
    },
  );

  server.registerTool(
    'simulate_friend_event',
    {
      title: '模拟好友事件',
      description: '模拟好友相关事件（请求、戳一戳、文件上传）',
      inputSchema: z.object({
        event_type: z.enum(['request', 'nudge', 'file_upload']).describe('事件类型'),
        initiator_id: zUin.optional().describe('发起者 QQ 号（request）'),
        user_id: zUin.optional().describe('好友 QQ 号（nudge, file_upload）'),
        comment: z.string().optional().describe('验证消息（request）'),
        via: z.string().optional().describe('来源（request）'),
        display_action: z.string().optional().describe('显示动作（nudge）'),
        display_suffix: z.string().optional().describe('显示后缀（nudge）'),
        file_name: z.string().optional().describe('文件名（file_upload）'),
        file_size: z.number().int().optional().describe('文件大小（file_upload）'),
      }).passthrough(),
    },
    async (params) => {
      const t = now();
      const self_id = state.bot.uin;

      switch (params.event_type) {
        case 'request': {
          const initiator_id = params.initiator_id as number;
          const uid = `uid_${initiator_id}`;
          state.friendRequests.push({
            time: t, initiatorId: initiator_id, initiatorUid: uid,
            targetUserId: self_id, targetUserUid: `uid_${self_id}`,
            state: 'pending', comment: (params.comment as string) ?? '',
            via: (params.via as string) ?? '', isFiltered: false,
          });
          events.emit({ time: t, self_id, event_type: 'friend_request',
            data: { initiator_id, initiator_uid: uid, comment: params.comment ?? '', via: params.via ?? '' } });
          return { content: [{ type: 'text', text: `Friend request simulated from ${initiator_id}` }] };
        }
        case 'nudge': {
          events.emit({ time: t, self_id, event_type: 'friend_nudge',
            data: { user_id: params.user_id, is_self_send: false, is_self_receive: true,
              display_action: params.display_action ?? '戳了戳', display_suffix: params.display_suffix ?? '', display_action_img_url: '' } });
          return { content: [{ type: 'text', text: `Friend nudge simulated from user ${params.user_id}` }] };
        }
        case 'file_upload': {
          events.emit({ time: t, self_id, event_type: 'friend_file_upload',
            data: { user_id: params.user_id, file_id: `f_${Date.now()}`, file_name: params.file_name, file_size: params.file_size, file_hash: '', is_self: false } });
          return { content: [{ type: 'text', text: `Friend file upload simulated: ${params.file_name} from user ${params.user_id}` }] };
        }
      }
    },
  );

  server.registerTool(
    'simulate_group_event',
    {
      title: '模拟群事件',
      description: '模拟群相关事件（入群、退群、禁言、戳一戳、文件上传等）',
      inputSchema: z.object({
        event_type: z.enum([
          'join_request', 'invited_join_request', 'invitation',
          'member_increase', 'member_decrease',
          'name_change', 'admin_change', 'essence_message_change',
          'message_reaction', 'mute', 'whole_mute', 'nudge', 'file_upload',
        ]).describe('事件类型'),
        group_id: zUin.describe('群号'),
        user_id: zUin.optional().describe('用户 QQ 号（member_increase/decrease, admin_change, mute, message_reaction, file_upload）'),
        operator_id: zUin.optional().describe('操作者 QQ 号'),
        invitor_id: zUin.optional().describe('邀请者 QQ 号（member_increase）'),
        initiator_id: zUin.optional().describe('发起者 QQ 号（join_request, invited_join_request, invitation）'),
        target_user_id: zUin.optional().describe('被邀请者 QQ 号（invited_join_request）'),
        comment: z.string().optional().describe('验证消息（join_request）'),
        new_group_name: z.string().optional().describe('新群名（name_change）'),
        is_set: z.boolean().optional().describe('是否设置（admin_change, essence_message_change）'),
        message_seq: z.number().int().optional().describe('消息序列号（essence_message_change, message_reaction）'),
        face_id: z.string().optional().describe('表情 ID（message_reaction）'),
        reaction_type: z.enum(['face', 'emoji']).optional().describe('回应类型（message_reaction）'),
        is_add: z.boolean().optional().describe('是否添加（message_reaction）'),
        duration: z.number().int().optional().describe('禁言时长秒（mute）'),
        is_mute: z.boolean().optional().describe('是否全员禁言（whole_mute）'),
        sender_id: zUin.optional().describe('发送者 QQ 号（nudge）'),
        receiver_id: zUin.optional().describe('接收者 QQ 号（nudge）'),
        display_action: z.string().optional().describe('显示动作（nudge）'),
        display_suffix: z.string().optional().describe('显示后缀（nudge）'),
        file_name: z.string().optional().describe('文件名（file_upload）'),
        file_size: z.number().int().optional().describe('文件大小（file_upload）'),
      }).passthrough(),
    },
    async (params) => {
      const gid = params.group_id as number;
      const t = now();
      const self_id = state.bot.uin;
      const et = params.event_type as string;

      const group = state.groups.get(gid);

      // State mutations + event data per event_type
      switch (et) {
        case 'join_request': {
          const notifSeq = seq.next(`notification_seq:group:${gid}`);
          if (!state.groupNotifications.has(gid)) state.groupNotifications.set(gid, []);
          state.groupNotifications.get(gid)!.push({
            type: 'join_request', groupId: gid, notificationSeq: notifSeq,
            isFiltered: false, initiatorId: params.initiator_id as number,
            state: 'pending', comment: (params.comment as string) ?? '',
          });
          events.emit({ time: t, self_id, event_type: 'group_join_request',
            data: { group_id: gid, notification_seq: notifSeq, is_filtered: false, initiator_id: params.initiator_id, comment: params.comment ?? '' } });
          break;
        }
        case 'invited_join_request': {
          const notifSeq = seq.next(`notification_seq:group:${gid}`);
          if (!state.groupNotifications.has(gid)) state.groupNotifications.set(gid, []);
          state.groupNotifications.get(gid)!.push({
            type: 'invited_join_request', groupId: gid, notificationSeq: notifSeq,
            initiatorId: params.initiator_id as number, targetUserId: params.target_user_id as number, state: 'pending',
          });
          events.emit({ time: t, self_id, event_type: 'group_invited_join_request',
            data: { group_id: gid, notification_seq: notifSeq, initiator_id: params.initiator_id, target_user_id: params.target_user_id } });
          break;
        }
        case 'invitation': {
          const invSeq = seq.next(`invitation_seq:${gid}`);
          state.groupInvitations.push({ groupId: gid, invitationSeq: invSeq, initiatorId: params.initiator_id as number });
          events.emit({ time: t, self_id, event_type: 'group_invitation',
            data: { group_id: gid, invitation_seq: invSeq, initiator_id: params.initiator_id } });
          break;
        }
        case 'member_increase': {
          const result = createMember(state, gid, params.user_id as number);
          if (!result.ok) return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
          events.emit({ time: t, self_id, event_type: 'group_member_increase',
            data: { group_id: gid, user_id: params.user_id, operator_id: params.operator_id, invitor_id: params.invitor_id } });
          break;
        }
        case 'member_decrease': {
          const result = deleteMember(state, gid, params.user_id as number);
          if (!result.ok) return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
          events.emit({ time: t, self_id, event_type: 'group_member_decrease',
            data: { group_id: gid, user_id: params.user_id, operator_id: params.operator_id } });
          break;
        }
        case 'name_change': {
          if (!group) return { content: [{ type: 'text', text: `Error: Group ${gid} not found` }], isError: true };
          group.groupName = params.new_group_name as string;
          events.emit({ time: t, self_id, event_type: 'group_name_change',
            data: { group_id: gid, new_group_name: params.new_group_name, operator_id: params.operator_id } });
          break;
        }
        case 'admin_change': {
          const isSet = params.is_set !== false;
          const role = isSet ? 'admin' as const : 'member' as const;
          const result = setMemberRole(state, gid, params.user_id as number, role);
          if (!result.ok) return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
          events.emit({ time: t, self_id, event_type: 'group_admin_change',
            data: { group_id: gid, user_id: params.user_id, operator_id: params.operator_id, is_set: isSet } });
          break;
        }
        case 'essence_message_change': {
          const isSet = params.is_set !== false;
          if (!state.groupEssenceMessages.has(gid)) state.groupEssenceMessages.set(gid, new Set());
          const essSet = state.groupEssenceMessages.get(gid)!;
          if (isSet) essSet.add(params.message_seq as number); else essSet.delete(params.message_seq as number);
          events.emit({ time: t, self_id, event_type: 'group_essence_message_change',
            data: { group_id: gid, message_seq: params.message_seq, operator_id: params.operator_id, is_set: isSet } });
          break;
        }
        case 'message_reaction': {
          events.emit({ time: t, self_id, event_type: 'group_message_reaction',
            data: { group_id: gid, user_id: params.user_id, message_seq: params.message_seq,
              face_id: params.face_id, reaction_type: params.reaction_type ?? 'face', is_add: params.is_add !== false } });
          break;
        }
        case 'mute': {
          if (group) {
            const member = group.members.get(params.user_id as number);
            if (member) member.shutUpEndTime = t + (params.duration as number);
          }
          events.emit({ time: t, self_id, event_type: 'group_mute',
            data: { group_id: gid, user_id: params.user_id, operator_id: params.operator_id, duration: params.duration } });
          break;
        }
        case 'whole_mute': {
          if (group) group.wholeMuted = params.is_mute !== false;
          events.emit({ time: t, self_id, event_type: 'group_whole_mute',
            data: { group_id: gid, operator_id: params.operator_id, is_mute: params.is_mute !== false } });
          break;
        }
        case 'nudge': {
          events.emit({ time: t, self_id, event_type: 'group_nudge',
            data: { group_id: gid, sender_id: params.sender_id, receiver_id: params.receiver_id,
              display_action: params.display_action ?? '戳了戳', display_suffix: params.display_suffix ?? '', display_action_img_url: '' } });
          break;
        }
        case 'file_upload': {
          events.emit({ time: t, self_id, event_type: 'group_file_upload',
            data: { group_id: gid, user_id: params.user_id, file_id: `gf_${Date.now()}`, file_name: params.file_name, file_size: params.file_size } });
          break;
        }
      }

      return { content: [{ type: 'text', text: `Group ${et} simulated in group ${gid}` }] };
    },
  );
}

async function convertToIncoming(seg: SimMessageSegment, state: SimState): Promise<SimMessageSegment> {
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
