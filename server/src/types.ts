// Internal simulation types that mirror milky protocol entities.
// These are mutable state representations, not Zod schemas.

export interface SimUser {
  userId: number;
  nickname: string;
  sex?: 'male' | 'female' | 'unknown';
  qid?: string;
  remark?: string;
  categoryId?: number;
  age?: number;
  bio?: string;
  level?: number;
  country?: string;
  city?: string;
  school?: string;
}

export interface SimGroupMember {
  userId: number;
  nickname: string;
  sex?: 'male' | 'female' | 'unknown';
  groupId: number;
  card?: string;
  title?: string;
  level?: number;
  role: 'owner' | 'admin' | 'member';
  joinTime: number;
  lastSentTime: number;
  shutUpEndTime?: number;
}

export interface SimGroup {
  groupId: number;
  groupName: string;
  memberCount: number;
  maxMemberCount: number;
  remark?: string;
  createdTime?: number;
  description?: string;
  question?: string;
  announcement?: string;
  members: Map<number, SimGroupMember>;
  wholeMuted: boolean;
}

export interface SimMessageSegment {
  type: string;
  [key: string]: unknown;
}

export interface SimMessage {
  scene: 'friend' | 'group' | 'temp';
  peerId: number;
  messageSeq: number;
  senderId: number;
  time: number;
  segments: SimMessageSegment[];
  recalled: boolean;
}

export interface SimFriendRequest {
  time: number;
  initiatorId: number;
  initiatorUid: string;
  targetUserId: number;
  targetUserUid: string;
  state: 'pending' | 'accepted' | 'rejected' | 'ignored';
  comment: string;
  via: string;
  isFiltered: boolean;
}

export interface SimGroupNotification {
  type: 'join_request' | 'admin_change' | 'kick' | 'quit' | 'invited_join_request';
  groupId: number;
  notificationSeq: number;
  isFiltered?: boolean;
  initiatorId?: number;
  targetUserId?: number;
  operatorId?: number;
  state?: 'pending' | 'accepted' | 'rejected' | 'ignored';
  isSet?: boolean;
  comment?: string;
}

export interface SimGroupAnnouncement {
  groupId: number;
  announcementId: string;
  userId: number;
  time: number;
  content: string;
  imageUrl?: string;
}

export interface SimGroupFile {
  groupId: number;
  fileId: string;
  fileName: string;
  parentFolderId: string;
  fileSize: number;
  uploadedTime: number;
  expireTime?: number;
  uploaderId: number;
  downloadedTimes: number;
}

export interface SimGroupFolder {
  groupId: number;
  folderId: string;
  parentFolderId: string;
  folderName: string;
  createdTime: number;
  lastModifiedTime: number;
  creatorId: number;
  fileCount: number;
}

export interface SimState {
  bot: {
    uin: number;
    nickname: string;
    bio?: string;
  };

  users: Map<number, SimUser>;
  groups: Map<number, SimGroup>;
  friends: Set<string>; // "botUin:userUin"

  messages: Map<string, SimMessage[]>; // key: "friend:peerId" | "group:groupId"
  clientSentMessages: SimMessage[];

  friendRequests: SimFriendRequest[];
  groupNotifications: Map<number, SimGroupNotification[]>;
  groupAnnouncements: Map<number, SimGroupAnnouncement[]>;
  groupEssenceMessages: Map<number, Set<number>>; // groupId -> set of messageSeq
  groupInvitations: Array<{ groupId: number; invitationSeq: number; initiatorId: number }>;

  groupFiles: Map<number, SimGroupFile[]>;
  groupFolders: Map<number, SimGroupFolder[]>;

  pinnedPeers: Set<string>; // "scene:peerId"
  customFaceUrls: string[];
}
