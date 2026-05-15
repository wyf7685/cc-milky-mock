import type { SimState, SimGroupMember } from '@/types.js';

export function createMember(
  state: SimState,
  group_id: number,
  user_id: number,
  opts?: { role?: string; card?: string },
): { ok: true; member: SimGroupMember } | { ok: false; error: string } {
  const group = state.groups.get(group_id);
  if (!group) return { ok: false, error: `Group ${group_id} not found` };
  const user = state.users.get(user_id);
  if (!user) return { ok: false, error: `User ${user_id} not found` };
  const now = Math.floor(Date.now() / 1000);
  const member: SimGroupMember = {
    userId: user_id,
    nickname: user.nickname,
    sex: user.sex,
    groupId: group_id,
    card: opts?.card ?? '',
    title: '',
    level: 1,
    role: (opts?.role as SimGroupMember['role']) ?? 'member',
    joinTime: now,
    lastSentTime: now,
  };
  group.members.set(user_id, member);
  group.memberCount = group.members.size;
  return { ok: true, member };
}

export function deleteMember(
  state: SimState,
  group_id: number,
  user_id: number,
): { ok: true } | { ok: false; error: string } {
  const group = state.groups.get(group_id);
  if (!group) return { ok: false, error: `Group ${group_id} not found` };
  if (!group.members.has(user_id)) return { ok: false, error: `User ${user_id} is not in group ${group_id}` };
  group.members.delete(user_id);
  group.memberCount = group.members.size;
  return { ok: true };
}

export function setMemberRole(
  state: SimState,
  group_id: number,
  user_id: number,
  role: 'owner' | 'admin' | 'member',
): { ok: true } | { ok: false; error: string } {
  const group = state.groups.get(group_id);
  if (!group) return { ok: false, error: `Group ${group_id} not found` };
  const member = group.members.get(user_id);
  if (!member) return { ok: false, error: `User ${user_id} is not in group ${group_id}` };
  member.role = role;
  return { ok: true };
}
