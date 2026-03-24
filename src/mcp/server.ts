#!/usr/bin/env node

// ============================================================
// AIR SDK — MCP Server
// Exposes AIR execution intelligence as tools via stdio transport.
//
// Usage:
//   npx @arcede/air-sdk --mcp
//   AIR_API_KEY=air_xxx air-mcp
// ============================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { resolveConfig } from '../core/config';
import { AIRHttpClient } from '../core/http';
import { CapabilityCache } from '../core/capability-cache';
import { SDK_VERSION } from '../version';
import { tools, handleToolCall } from './tools';

// ---- Bootstrap ----

let _started = false;

async function main(): Promise<void> {
  if (_started) return;
  _started = true;
  // 1. Validate API key from environment
  const apiKey = process.env.AIR_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'Error: AIR_API_KEY environment variable is required.\n' +
        'Set it in your MCP server config or shell environment:\n\n' +
        '  export AIR_API_KEY=air_xxx\n\n' +
        'Or in your MCP client config (e.g. claude_desktop_config.json):\n\n' +
        '  "env": { "AIR_API_KEY": "air_xxx" }\n'
    );
    process.exit(1);
  }

  // 2. Detect which MCP client is running us
  const clientId = process.env.AIR_CLIENT_ID  // explicit override
    || (process.env.CLAUDE_DESKTOP ? 'claude-desktop' : null)
    || (process.env.CURSOR_TRACE_ID ? 'cursor' : null)
    || (process.env.WINDSURF_SESSION_ID ? 'windsurf' : null)
    || 'mcp-generic';

  // 3. Resolve SDK config with sensible server-side defaults
  const config = resolveConfig({
    apiKey,
    baseURL: process.env.AIR_BASE_URL,
    cacheEnabled: true,
    includeExecution: true, // MCP server always wants rich execution data
    telemetryEnabled: false, // MCP server doesn't generate telemetry
    debug: process.env.AIR_DEBUG === 'true',
    clientId,
    sdkVersion: SDK_VERSION,
  });

  // 3. Create shared instances
  const httpClient = new AIRHttpClient(config);
  const cache = new CapabilityCache(config, httpClient);

  // 4. Create MCP server
  const server = new Server(
    {
      name: 'air-sdk',
      version: SDK_VERSION,
    },
    {
      capabilities: { tools: {} },
    }
  );

  // 5. Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools],
  }));

  // 6. Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args, cache, httpClient);
  });

  // 7. Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (config.debug) {
    process.stderr.write(`[AIR MCP] Server started (v${SDK_VERSION})\n`);
  }
}

// ---- Entry Point ----

export default main;

// Auto-start when invoked as a CLI binary.
// tsup bundles this as dist/mcp/server.js which package.json maps to `air-mcp`.
// We detect direct invocation by checking if the resolved script path contains
// our known entry pattern, or if --mcp was passed explicitly.
const runningScript = process.argv[1] ?? '';
const shouldAutoStart =
  runningScript.endsWith('mcp/server.js') ||
  runningScript.endsWith('mcp/server.mjs') ||
  runningScript.endsWith('mcp/server.ts') ||
  process.argv.includes('--mcp');

if (shouldAutoStart) {
  main().catch((err) => {
    process.stderr.write(`[AIR MCP] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
