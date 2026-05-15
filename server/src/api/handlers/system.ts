import type { ApiHandler } from '@/api/registry.js';

export function registerSystemHandlers(handlers: Map<string, ApiHandler>): void {
  handlers.set('get_login_info', (_p, { state }) => {
    return { uin: state.bot.uin, nickname: state.bot.nickname };
  });

  handlers.set('get_impl_info', () => {
    return {
      impl_name: 'milky-mcp-server',
      impl_version: '0.1.0',
      qq_protocol_version: '1.0.0',
      qq_protocol_type: 'linux',
      milky_version: '1.2',
    };
  });

  handlers.set('get_user_profile', ({ user_id }, { state }) => {
    const uid = Number(user_id);
    const user = state.users.get(uid);
    if (!user) throw new Error(`User ${uid} not found`);
    return {
      nickname: user.nickname,
      qid: user.qid ?? '',
      remark: user.remark ?? '',
      bio: user.bio ?? '',
      country: user.country ?? '',
      city: user.city ?? '',
      school: user.school ?? '',
      age: user.age ?? 0,
      level: user.level ?? 0,
      sex: user.sex ?? 'unknown',
    };
  });

  handlers.set('get_friend_list', (_p, { state }) => {
    const friends = [];
    for (const key of state.friends) {
      const [, userUid] = key.split(':');
      const user = state.users.get(Number(userUid));
      if (user) {
        friends.push({
          user_id: user.userId,
          nickname: user.nickname,
          sex: user.sex ?? 'unknown',
          qid: user.qid ?? '',
          remark: user.remark ?? '',
          category: { category_id: user.categoryId ?? 0, category_name: '默认分组' },
        });
      }
    }
    return { friends };
  });

  handlers.set('get_friend_info', ({ user_id, no_cache }, { state }) => {
    const uid = Number(user_id);
    const key = `${state.bot.uin}:${uid}`;
    if (!state.friends.has(key)) throw new Error(`User ${uid} is not a friend`);
    const user = state.users.get(uid);
    if (!user) throw new Error(`User ${uid} not found`);
    return {
      friend: {
        user_id: user.userId,
        nickname: user.nickname,
        sex: user.sex ?? 'unknown',
        qid: user.qid ?? '',
        remark: user.remark ?? '',
        category: { category_id: user.categoryId ?? 0, category_name: '默认分组' },
      },
    };
  });

  handlers.set('get_group_list', (_p, { state }) => {
    const groups = [];
    for (const group of state.groups.values()) {
      groups.push({
        group_id: group.groupId,
        group_name: group.groupName,
        member_count: group.memberCount,
        max_member_count: group.maxMemberCount,
        remark: group.remark ?? '',
        created_time: group.createdTime ?? 0,
        description: group.description ?? '',
        question: group.question ?? '',
        announcement: group.announcement ?? '',
      });
    }
    return { groups };
  });

  handlers.set('get_group_info', ({ group_id }, { state }) => {
    const gid = Number(group_id);
    const group = state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    return {
      group: {
        group_id: group.groupId,
        group_name: group.groupName,
        member_count: group.memberCount,
        max_member_count: group.maxMemberCount,
        remark: group.remark ?? '',
        created_time: group.createdTime ?? 0,
        description: group.description ?? '',
        question: group.question ?? '',
        announcement: group.announcement ?? '',
      },
    };
  });

  handlers.set('get_group_member_list', ({ group_id }, { state }) => {
    const gid = Number(group_id);
    const group = state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    const members = [];
    for (const m of group.members.values()) {
      members.push({
        user_id: m.userId,
        nickname: m.nickname,
        sex: m.sex ?? 'unknown',
        group_id: m.groupId,
        card: m.card ?? '',
        title: m.title ?? '',
        level: m.level ?? 0,
        role: m.role,
        join_time: m.joinTime,
        last_sent_time: m.lastSentTime,
        shut_up_end_time: m.shutUpEndTime ?? 0,
      });
    }
    return { members };
  });

  handlers.set('get_group_member_info', ({ group_id, user_id }, { state }) => {
    const gid = Number(group_id);
    const uid = Number(user_id);
    const group = state.groups.get(gid);
    if (!group) throw new Error(`Group ${gid} not found`);
    const m = group.members.get(uid);
    if (!m) throw new Error(`Member ${uid} not found in group ${gid}`);
    return {
      member: {
        user_id: m.userId,
        nickname: m.nickname,
        sex: m.sex ?? 'unknown',
        group_id: m.groupId,
        card: m.card ?? '',
        title: m.title ?? '',
        level: m.level ?? 0,
        role: m.role,
        join_time: m.joinTime,
        last_sent_time: m.lastSentTime,
        shut_up_end_time: m.shutUpEndTime ?? 0,
      },
    };
  });

  handlers.set('get_peer_pins', (_p, { state }) => {
    const friends = [];
    const groups = [];
    for (const pin of state.pinnedPeers) {
      const [scene, peerId] = pin.split(':');
      const pid = Number(peerId);
      if (scene === 'friend') {
        const user = state.users.get(pid);
        if (user) {
          friends.push({
            user_id: user.userId,
            nickname: user.nickname,
            sex: user.sex ?? 'unknown',
            qid: user.qid ?? '',
            remark: user.remark ?? '',
            category: { category_id: user.categoryId ?? 0, category_name: '默认分组' },
          });
        }
      } else if (scene === 'group') {
        const group = state.groups.get(pid);
        if (group) {
          groups.push({
            group_id: group.groupId,
            group_name: group.groupName,
            member_count: group.memberCount,
            max_member_count: group.maxMemberCount,
          });
        }
      }
    }
    return { friends, groups };
  });

  handlers.set('set_peer_pin', ({ message_scene, peer_id, is_pinned }, { state }) => {
    const key = `${message_scene}:${peer_id}`;
    if (is_pinned !== false) {
      state.pinnedPeers.add(key);
    } else {
      state.pinnedPeers.delete(key);
    }
    return {};
  });

  handlers.set('set_avatar', () => {
    return {};
  });

  handlers.set('set_nickname', ({ new_nickname }, { state }) => {
    state.bot.nickname = String(new_nickname);
    return {};
  });

  handlers.set('set_bio', ({ new_bio }, { state }) => {
    state.bot.bio = String(new_bio);
    return {};
  });

  handlers.set('get_custom_face_url_list', (_p, { state }) => {
    return { urls: state.customFaceUrls };
  });

  handlers.set('get_cookies', () => {
    return { cookies: 'mock_cookie=value' };
  });

  handlers.set('get_csrf_token', () => {
    return { csrf_token: 'mock_csrf_token' };
  });
}
