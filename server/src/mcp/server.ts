import { McpServer } from '@modelcontextprotocol/server';
import type { SimState } from '@/types.js';
import type { EventBus } from '@/state/events.js';
import type { SequenceGenerator } from '@/state/sequences.js';
import { registerEnvTools } from './tools/env.js';
import { registerSimulateTools } from './tools/simulate.js';
import { registerInspectTools } from './tools/inspect.js';
import { registerServerTools } from './tools/server.js';

export function createMcpServer(
  state: SimState,
  events: EventBus,
  seq: SequenceGenerator,
): McpServer {
  const server = new McpServer({
    name: 'milky-mcp-server',
    version: '0.1.0',
  });

  registerServerTools(server, state, events, seq);
  registerEnvTools(server, state, events, seq);
  registerSimulateTools(server, state, events, seq);
  registerInspectTools(server, state, events);

  return server;
}
