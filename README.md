# Toolception – Dynamic MCP Tooling Library

## Quickstart

Install:

```bash
npm i toolception
```

Create a server with dynamic tool management (Fastify transport included):

```ts
import { createMcpServer } from "toolception";

const catalog = {
  quotes: { name: "Quotes", description: "Market quotes", modules: ["quotes"] },
};

// A simple MCP server tool used below
const quoteTool = {
  name: "price",
  description: "Return a fake price",
  inputSchema: {
    type: "object",
    properties: { symbol: { type: "string" } },
    required: ["symbol"],
  },
  handler: async ({ symbol }: { symbol: string }) => ({
    content: [{ type: "text", text: `${symbol}: 123.45` }],
  }),
} as const;

// Module loaders return MCP server tools (McpToolDefinition[]) that will be
// registered on the MCP server. Each tool must include `name`, `description`,
// a JSON Schema `inputSchema`, and a `handler` that returns MCP content
// (e.g., { content: [{ type: 'text', text: '...' }] }).
const moduleLoaders = {
  quotes: async () => [quoteTool],
};

const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    REQUIRED_PARAM: { type: "string", title: "Required Param" },
    OPTIONAL_PARAM: { type: "string", title: "Optional Param" },
  },
  required: ["REQUIRED_PARAM"],
} as const;

const { start, close } = await createMcpServer({
  catalog,
  moduleLoaders,
  startup: { mode: "DYNAMIC" },
  http: { port: 3000 },
});
await start();

// Graceful shutdown
process.on("SIGINT", async () => {
  await close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await close();
  process.exit(0);
});
```

## Static startup

Enable some or ALL toolsets at bootstrap:

```ts
const staticCatalog = {
  search: { name: "Search", description: "Search tools", modules: ["search"] },
  quotes: { name: "Quotes", description: "Market quotes", modules: ["quotes"] },
};

createMcpServer({
  catalog: staticCatalog,
  startup: { mode: "STATIC", toolsets: ["search", "quotes"] },
  http: { port: 3001 },
});

createMcpServer({
  catalog: staticCatalog,
  startup: { mode: "STATIC", toolsets: "ALL" },
  http: { port: 3002 },
});
```

See `examples/` for runnable snippets. See `AGENTS.md` for LLM/agent-oriented guidance.

## API

- createMcpServer(options): creates an MCP server with dynamic/static tool management and Fastify transport.
  - catalog: Record<string, { name: string; description: string; tools?: McpToolDefinition[]; modules?: string[]; decisionCriteria?: string }>
  - moduleLoaders?: Record<string, ModuleLoader> (loader returns McpToolDefinition[]; used when enabling toolsets that reference its key)
  - startup?: { mode: "DYNAMIC" | "STATIC"; toolsets?: string[] | "ALL" }
  - registerMetaTools?: boolean
  - exposurePolicy?: ExposurePolicy
  - context?: unknown (passed to loaders when resolving tools)
  - http?: { host?: string; port?: number; basePath?: string; cors?: boolean; logger?: boolean }

Meta-tools (enabled by default in DYNAMIC):

- enable_toolset, disable_toolset, list_toolsets, list_tools

## Client ID lifecycle

- **What**: Clients identify themselves via the `mcp-client-id` HTTP header on every request.
- **Who generates it**: The client. Use a stable identifier (e.g., UUID persisted locally).
- **If omitted**: The server assigns a one-off `anon-<uuid>` and skips caching; this is unsuitable for multi-request flows and SSE.

Examples (official MCP client)

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Create a stable client id (persist it for reuse across runs)
const clientId = "my-stable-client-id"; // e.g., from disk/env

// Transport manages HTTP, including SSE and JSON-RPC framing
const transport = new StreamableHTTPClientTransport(
  {
    url: "http://localhost:3000/mcp",
    headers: { "mcp-client-id": clientId },
  },
  {
    // Optional: receive server-sent events (notifications)
    onreconnect: () => console.log("Reconnected"),
  }
);

// High-level MCP client
const client = new Client({ name: "example-client", version: "1.0.0" });

// Initialize will negotiate capabilities and establish a session.
// The server issues the session id; the transport handles it automatically.
await client.connect(transport);
await client.initialize();

// Call a tool (example)
const res = await client.callTool("list_tools", {});
console.log(res);

// Close when done
await client.close();
```

## Session ID lifecycle

- **What**: A per-session identifier returned by the server on initialize.
- **Who generates it**: The server during initialize. The client must read it from the initialize response headers and send it back on subsequent requests via `mcp-session-id`.
- **Used for**: Follow-up JSON-RPC requests (POST `/mcp`), SSE stream (GET `/mcp`), and termination (DELETE `/mcp`).

Examples (official MCP client)

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const clientId = "my-stable-client-id";
const transport = new StreamableHTTPClientTransport({
  url: "http://localhost:3000/mcp",
  headers: { "mcp-client-id": clientId },
});

const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);
await client.initialize();

// Session id is issued by the server on initialize and handled by the transport.
// You do not need to manually manage the mcp-session-id header.

// Example SSE consumption happens under the hood; you can subscribe to notifications
client.on("notification", (n) => console.log("notification:", n));

// When finished
await client.close();
```

## Tool types

- Direct tools: defined inline under `catalog[toolset].tools` and registered when that toolset is enabled.
- Module-produced tools: returned by `moduleLoaders[moduleKey]()` and registered when enabling a toolset that references `modules: [moduleKey]`.

Use direct tools for simple/local utilities; use module-produced tools to share tools across multiple toolsets or lazily load heavier definitions.

Note on dynamic mode: Both direct and module-produced tools are supported. Module-produced tools help minimize startup footprint by enabling on-demand loading at enable-time.

## Startup modes

The server operates in one of two primary modes (legacy load-all is not recommended here):

1. Dynamic mode (startup.mode = "DYNAMIC")

   - Starts with meta-tools for runtime management: `enable_toolset`, `disable_toolset`, `list_toolsets`, `describe_toolset`, and `list_tools` (always available)
   - Tools are loaded on-demand via meta-tool calls
   - Best for flexible, task-specific workflows where tool needs change

2. Static mode (startup.mode = "STATIC")
   - Pre-loads specific toolsets at startup (`toolsets` array or "ALL")
   - Meta-tools limited to `list_tools` by default
   - Best for known, consistent tool requirements

## Examples

- See `examples/` for runnable scripts:
  - `npx --yes tsx examples/basic.ts`
  - `npx --yes tsx examples/static-startup.ts`
  - `npx --yes tsx examples/static-all.ts`
