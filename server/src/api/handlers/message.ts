import type { ApiHandler } from '@/api/registry.js';
import { getMessageKey } from '@/state/store.js';
import type { SimMessage, SimMessageSegment } from '@/types.js';

export function registerMessageHandlers(handlers: Map<string, ApiHandler>): void {
  handlers.set('send_private_message', ({ user_id, message }, ctx) => {
    const uid = Number(user_id);
    const segments = (message as SimMessageSegment[]) ?? [];
    const messageSeq = ctx.seq.next(`message_seq:friend:${uid}`);
    const time = Math.floor(Date.now() / 1000);
    const msg: SimMessage = {
      scene: 'friend',
      peerId: uid,
      messageSeq,
      senderId: ctx.state.bot.uin,
      time,
      segments,
      recalled: false,
    };
    const key = getMessageKey('friend', uid);
    if (!ctx.state.messages.has(key)) ctx.state.messages.set(key, []);
    ctx.state.messages.get(key)!.push(msg);
    ctx.state.clientSentMessages.push(msg);
    return { message_seq: messageSeq, time };
  });

  handlers.set('send_group_message', ({ group_id, message }, ctx) => {
    const gid = Number(group_id);
    if (!ctx.state.groups.has(gid)) throw new Error(`Group ${gid} not found`);
    const segments = (message as SimMessageSegment[]) ?? [];
    const messageSeq = ctx.seq.next(`message_seq:group:${gid}`);
    const time = Math.floor(Date.now() / 1000);
    const msg: SimMessage = {
      scene: 'group',
      peerId: gid,
      messageSeq,
      senderId: ctx.state.bot.uin,
      time,
      segments,
      recalled: false,
    };
    const key = getMessageKey('group', gid);
    if (!ctx.state.messages.has(key)) ctx.state.messages.set(key, []);
    ctx.state.messages.get(key)!.push(msg);
    ctx.state.clientSentMessages.push(msg);
    return { message_seq: messageSeq, time };
  });

  handlers.set('recall_private_message', ({ user_id, message_seq }, ctx) => {
    const uid = Number(user_id);
    const seq = Number(message_seq);
    const key = getMessageKey('friend', uid);
    const msgs = ctx.state.messages.get(key);
    const msg = msgs?.find((m) => m.messageSeq === seq);
    if (msg) msg.recalled = true;
    return {};
  });

  handlers.set('recall_group_message', ({ group_id, message_seq }, ctx) => {
    const gid = Number(group_id);
    const seq = Number(message_seq);
    const key = getMessageKey('group', gid);
    const msgs = ctx.state.messages.get(key);
    const msg = msgs?.find((m) => m.messageSeq === seq);
    if (msg) msg.recalled = true;
    return {};
  });

  handlers.set('get_message', ({ message_scene, peer_id, message_seq }, ctx) => {
    const scene = String(message_scene);
    const pid = Number(peer_id);
    const seq = Number(message_seq);
    const key = getMessageKey(scene, pid);
    const msgs = ctx.state.messages.get(key);
    const msg = msgs?.find((m) => m.messageSeq === seq);
    if (!msg) throw new Error(`Message ${seq} not found`);
    return { message: formatMessage(msg, ctx.state) };
  });

  handlers.set('get_history_messages', ({ message_scene, peer_id, start_message_seq, limit }, ctx) => {
    const scene = String(message_scene);
    const pid = Number(peer_id);
    const key = getMessageKey(scene, pid);
    const msgs = ctx.state.messages.get(key) ?? [];
    const limitNum = Number(limit) || 20;
    const startSeq = start_message_seq != null ? Number(start_message_seq) : undefined;

    let filtered = msgs.filter((m) => !m.recalled);
    if (startSeq != null) {
      filtered = filtered.filter((m) => m.messageSeq < startSeq);
    }
    const result = filtered.slice(-limitNum);
    const nextMessageSeq = result.length > 0 ? result[0].messageSeq : undefined;

    return {
      messages: result.map((m) => formatMessage(m, ctx.state)),
      next_message_seq: nextMessageSeq,
    };
  });

  handlers.set('get_resource_temp_url', ({ resource_id }) => {
    return { url: `https://mock.milky.local/resource/${resource_id}` };
  });

  handlers.set('get_forwarded_messages', ({ forward_id }) => {
    return { messages: [] };
  });

  handlers.set('mark_message_as_read', () => {
    return {};
  });
}

// biome-ignore lint: complex state-dependent formatting
function formatMessage(msg: SimMessage, state: any): object {
  const base = {
    peer_id: msg.peerId,
    message_seq: msg.messageSeq,
    sender_id: msg.senderId,
    time: msg.time,
    segments: msg.segments,
  };

  if (msg.scene === 'friend') {
    const user = state.users.get(msg.senderId);
    return {
      message_scene: 'friend',
      ...base,
      friend: user
        ? {
            user_id: user.userId,
            nickname: user.nickname,
            sex: user.sex ?? 'unknown',
            qid: user.qid ?? '',
            remark: user.remark ?? '',
            category: { category_id: user.categoryId ?? 0, category_name: '默认分组' },
          }
        : { user_id: msg.senderId, nickname: 'unknown', sex: 'unknown', qid: '', remark: '', category: { category_id: 0, category_name: '' } },
    };
  }

  if (msg.scene === 'group') {
    const group = state.groups.get(msg.peerId);
    const member = group?.members.get(msg.senderId);
    return {
      message_scene: 'group',
      ...base,
      group: group
        ? { group_id: group.groupId, group_name: group.groupName, member_count: group.memberCount, max_member_count: group.maxMemberCount }
        : { group_id: msg.peerId, group_name: '', member_count: 0, max_member_count: 0 },
      group_member: member
        ? { user_id: member.userId, nickname: member.nickname, sex: member.sex ?? 'unknown', group_id: member.groupId, card: member.card ?? '', title: member.title ?? '', level: member.level ?? 0, role: member.role, join_time: member.joinTime, last_sent_time: member.lastSentTime, shut_up_end_time: member.shutUpEndTime ?? 0 }
        : { user_id: msg.senderId, nickname: 'unknown', sex: 'unknown', group_id: msg.peerId, card: '', title: '', level: 0, role: 'member', join_time: 0, last_sent_time: 0, shut_up_end_time: 0 },
    };
  }

  return { message_scene: 'temp', ...base };
}
