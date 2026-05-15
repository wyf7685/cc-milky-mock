#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { createStore } from './state/store.js';
import { SequenceGenerator } from './state/sequences.js';
import { EventBus } from './state/events.js';
import { registerAllHandlers } from './api/registry.js';
import { createMcpServer } from './mcp/server.js';
import { stopServer } from './mcp/tools/server.js';

async function cleanup() {
  await stopServer();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function main() {
  const state = createStore();
  const seq = new SequenceGenerator();
  const events = new EventBus();

  registerAllHandlers();

  const mcpServer = createMcpServer(state, events, seq);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[milky-mcp] MCP server ready (stdio). Use start_milky_server to launch HTTP server.');
}

main().catch((err) => {
  console.error('[milky-mcp] Fatal error:', err);
  process.exit(1);
});
