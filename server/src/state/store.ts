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
    clientSentMessages: [],
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

export function getMessageKey(scene: string, peerId: number): string {
  return `${scene}:${peerId}`;
}
