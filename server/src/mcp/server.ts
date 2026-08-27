import { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import type { ActivityLog } from '@/state/activity.js';
import { registerEnvTools } from './tools/env.js';
import { registerSimulateTools } from './tools/simulate.js';
import { registerInspectTools } from './tools/inspect.js';
import { registerServerTools } from './tools/server.js';

export function createMcpServer(
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
  activity: ActivityLog,
): McpServer {
  const server = new McpServer({
    name: 'milky-mcp-server',
    version: '0.5.0',
  });

  registerServerTools(server, state, events, seq, activity);
  registerEnvTools(server, state, events, seq, activity);
  registerSimulateTools(server, state, events, seq);
  registerInspectTools(server, state, events, activity);

  return server;
}
