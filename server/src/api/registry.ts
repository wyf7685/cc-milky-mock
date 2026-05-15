import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { registerSystemHandlers } from './handlers/system.js';
import { registerMessageHandlers } from './handlers/message.js';
import { registerGroupHandlers } from './handlers/group.js';
import { registerFriendHandlers } from './handlers/friend.js';
import { registerFileHandlers } from './handlers/file.js';

export interface ApiContext {
  state: SimState;
  events: EventBus;
  seq: SequenceGenerator;
}

export type ApiHandler = (params: Record<string, unknown>, ctx: ApiContext) => Promise<unknown> | unknown;

const handlers = new Map<string, ApiHandler>();

export function registerAllHandlers(): void {
  registerSystemHandlers(handlers);
  registerMessageHandlers(handlers);
  registerGroupHandlers(handlers);
  registerFriendHandlers(handlers);
  registerFileHandlers(handlers);
}

export function getHandler(endpoint: string): ApiHandler | undefined {
  return handlers.get(endpoint);
}
