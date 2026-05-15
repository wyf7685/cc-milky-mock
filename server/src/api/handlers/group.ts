import type { ApiHandler } from '@/api/registry.js';

export function registerGroupHandlers(handlers: Map<string, ApiHandler>): void {
  handlers.set('set_group_name', ({ group_id, new_group_name }, ctx) => {
    const gid = Number(group_id);
    const group = ctx.state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    group.groupName = String(new_group_name);
    return {};
  });

  handlers.set('set_group_avatar', () => ({}));

  handlers.set('set_group_member_card', ({ group_id, user_id, card }, ctx) => {
    const gid = Number(group_id);
    const uid = Number(user_id);
    const group = ctx.state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    const member = group.members.get(uid);
    if (!member) throw new Error(`Member ${uid} not found in group ${gid}`);
    member.card = String(card);
    return {};
  });

  handlers.set('set_group_member_special_title', ({ group_id, user_id, special_title }, ctx) => {
    const gid = Number(group_id);
    const uid = Number(user_id);
    const group = ctx.state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    const member = group.members.get(uid);
    if (!member) throw new Error(`Member ${uid} not found in group ${gid}`);
    member.title = String(special_title);
    return {};
  });

  handlers.set('set_group_member_admin', ({ group_id, user_id, is_set }, ctx) => {
    const gid = Number(group_id);
    const uid = Number(user_id);
    const group = ctx.state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    const member = group.members.get(uid);
    if (!member) throw new Error(`Member ${uid} not found in group ${gid}`);
    member.role = is_set !== false ? 'admin' : 'member';
    return {};
  });

  handlers.set('set_group_member_mute', ({ group_id, user_id, duration }, ctx) => {
    const gid = Number(group_id);
    const uid = Number(user_id);
    const dur = Number(duration) || 0;
    const group = ctx.state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    const member = group.members.get(uid);
    if (!member) throw new Error(`Member ${uid} not found in group ${gid}`);
    member.shutUpEndTime = dur > 0 ? Math.floor(Date.now() / 1000) + dur : 0;
    return {};
  });

  handlers.set('set_group_whole_mute', ({ group_id, is_mute }, ctx) => {
    const gid = Number(group_id);
    const group = ctx.state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    group.wholeMuted = is_mute !== false;
    return {};
  });

  handlers.set('kick_group_member', ({ group_id, user_id, reject_add_request }, ctx) => {
    const gid = Number(group_id);
    const uid = Number(user_id);
    const group = ctx.state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    if (!group.members.has(uid)) throw new Error(`Member ${uid} not found in group ${gid}`);
    group.members.delete(uid);
    group.memberCount = group.members.size;
    return {};
  });

  handlers.set('get_group_announcements', ({ group_id }, ctx) => {
    const gid = Number(group_id);
    const announcements = ctx.state.groupAnnouncements.get(gid) ?? [];
    return { announcements };
  });

  handlers.set('send_group_announcement', ({ group_id, content, image_uri }, ctx) => {
    const gid = Number(group_id);
    if (!ctx.state.groups.has(gid)) throw new Error(`Group ${gid} not found`);
    const announcementId = `ann_${ctx.seq.next(`announcement:group:${gid}`)}`;
    if (!ctx.state.groupAnnouncements.has(gid)) ctx.state.groupAnnouncements.set(gid, []);
    ctx.state.groupAnnouncements.get(gid)!.push({
      groupId: gid,
      announcementId,
      userId: ctx.state.bot.uin,
      time: Math.floor(Date.now() / 1000),
      content: String(content),
      imageUrl: image_uri != null ? String(image_uri) : undefined,
    });
    return {};
  });

  handlers.set('delete_group_announcement', ({ group_id, announcement_id }, ctx) => {
    const gid = Number(group_id);
    const annId = String(announcement_id);
    const announcements = ctx.state.groupAnnouncements.get(gid);
    if (announcements) {
      const idx = announcements.findIndex((a) => a.announcementId === annId);
      if (idx >= 0) announcements.splice(idx, 1);
    }
    return {};
  });

  handlers.set('get_group_essence_messages', ({ group_id, page_index, page_size }, ctx) => {
    const gid = Number(group_id);
    const essSet = ctx.state.groupEssenceMessages.get(gid) ?? new Set();
    const allMsgs = ctx.state.messages.get(`group:${gid}`) ?? [];
    const essence = allMsgs.filter((m) => essSet.has(m.messageSeq));
    const pi = Number(page_index) || 0;
    const ps = Number(page_size) || 20;
    const sliced = essence.slice(pi * ps, (pi + 1) * ps);
    return {
      messages: sliced.map((m) => ({
        group_id: gid,
        message_seq: m.messageSeq,
        message_time: m.time,
        sender_id: m.senderId,
        sender_name: ctx.state.groups.get(gid)?.members.get(m.senderId)?.nickname ?? '',
        operator_id: ctx.state.bot.uin,
        operator_name: ctx.state.bot.nickname,
        operation_time: m.time,
        segments: m.segments,
      })),
      is_end: (pi + 1) * ps >= essence.length,
    };
  });

  handlers.set('set_group_essence_message', ({ group_id, message_seq, is_set }, ctx) => {
    const gid = Number(group_id);
    const seq = Number(message_seq);
    if (!ctx.state.groupEssenceMessages.has(gid)) ctx.state.groupEssenceMessages.set(gid, new Set());
    const set = ctx.state.groupEssenceMessages.get(gid)!;
    if (is_set !== false) {
      set.add(seq);
    } else {
      set.delete(seq);
    }
    return {};
  });

  handlers.set('quit_group', ({ group_id }, ctx) => {
    const gid = Number(group_id);
    ctx.state.groups.delete(gid);
    return {};
  });

  handlers.set('send_group_message_reaction', () => ({}));
  handlers.set('send_group_nudge', () => ({}));

  handlers.set('get_group_notifications', ({ start_notification_seq, is_filtered, limit }, ctx) => {
    const allNotifications = [];
    for (const notifs of ctx.state.groupNotifications.values()) {
      allNotifications.push(...notifs);
    }
    const startSeq = start_notification_seq != null ? Number(start_notification_seq) : undefined;
    let filtered = allNotifications;
    if (startSeq != null) {
      filtered = filtered.filter((n) => n.notificationSeq < startSeq);
    }
    const limitNum = Number(limit) || 20;
    const result = filtered.slice(-limitNum);
    const nextSeq = result.length > 0 ? result[0].notificationSeq : undefined;
    return {
      notifications: result,
      next_notification_seq: nextSeq,
    };
  });

  handlers.set('accept_group_request', () => ({}));
  handlers.set('reject_group_request', () => ({}));
  handlers.set('accept_group_invitation', () => ({}));
  handlers.set('reject_group_invitation', () => ({}));
}
