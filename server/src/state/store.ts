import type { SimState } from '@/types.js';
import { ResourceStore } from '@/utils/resources.js';

export function createStore(): SimState {
  return {
    bot: {
      uin: 10001,
      nickname: 'Milky Mock Bot',
    },
    users: new Map(),
    groups: new Map(),
    friends: new Set(),
    messages: new Map(),
    forwardedMessages: new Map(),
    friendRequests: [],
    groupNotifications: new Map(),
    groupAnnouncements: new Map(),
    groupEssenceMessages: new Map(),
    groupInvitations: [],
    groupFiles: new Map(),
    groupFolders: new Map(),
    pinnedPeers: new Set(),
    customFaceUrls: [],
    resourceStore: new ResourceStore(),
  };
}
export function resetStore(state: SimState): void {
  state.resourceStore.cleanup();

  state.bot.uin = 10001;
  state.bot.nickname = 'Milky Mock Bot';
  delete state.bot.bio;

  state.users.clear();
  state.groups.clear();
  state.friends.clear();
  state.messages.clear();
  state.forwardedMessages.clear();
  state.friendRequests.length = 0;
  state.groupNotifications.clear();
  state.groupAnnouncements.clear();
  state.groupEssenceMessages.clear();
  state.groupInvitations.length = 0;
  state.groupFiles.clear();
  state.groupFolders.clear();
  state.pinnedPeers.clear();
  state.customFaceUrls.length = 0;
}


export function getMessageKey(scene: string, peerId: number): string {
  return `${scene}:${peerId}`;
}
