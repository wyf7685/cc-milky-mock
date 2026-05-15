import type { ApiHandler } from '@/api/registry.js';

export function registerFriendHandlers(handlers: Map<string, ApiHandler>): void {
  handlers.set('send_friend_nudge', () => ({}));
  handlers.set('send_profile_like', () => ({}));

  handlers.set('delete_friend', ({ user_id }, ctx) => {
    const uid = Number(user_id);
    ctx.state.friends.delete(`${ctx.state.bot.uin}:${uid}`);
    return {};
  });

  handlers.set('get_friend_requests', ({ limit, is_filtered }, ctx) => {
    const limitNum = Number(limit) || 20;
    const filtered = is_filtered === true;
    const requests = ctx.state.friendRequests
      .filter((r) => r.isFiltered === filtered)
      .slice(-limitNum);
    return { requests };
  });

  handlers.set('accept_friend_request', ({ initiator_uid, is_filtered }, ctx) => {
    const uid = String(initiator_uid);
    const req = ctx.state.friendRequests.find(
      (r) => r.initiatorUid === uid && r.isFiltered === (is_filtered === true),
    );
    if (req) req.state = 'accepted';
    return {};
  });

  handlers.set('reject_friend_request', ({ initiator_uid, is_filtered, reason }, ctx) => {
    const uid = String(initiator_uid);
    const req = ctx.state.friendRequests.find(
      (r) => r.initiatorUid === uid && r.isFiltered === (is_filtered === true),
    );
    if (req) req.state = 'rejected';
    return {};
  });
}
