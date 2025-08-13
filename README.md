# Toolception – Dynamic MCP Tooling Library

[![npm version](https://img.shields.io/npm/v/toolception.svg)](https://www.npmjs.com/package/toolception)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Table of Contents

- [Starter guide](#starter-guide)
- [Static startup](#static-startup)
- [API](#api)
- [Client ID lifecycle](#client-id-lifecycle)
- [Session ID lifecycle](#session-id-lifecycle)
- [Tool types](#tool-types)
- [Startup modes](#startup-modes)
- [License](#license)

## Starter guide

### Step 1: Install

```bash
npm i toolception
```

### Step 2: Import Toolception

```ts
import { createMcpServer } from "toolception";
```

### Step 3: Define a toolset catalog

```ts
const catalog = {
  quotes: { name: "Quotes", description: "Market quotes", modules: ["quotes"] },
};
```

### Step 4: Define a tool

```ts
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
```

### Step 5: Provide module loaders

```ts
const moduleLoaders = {
  quotes: async () => [quoteTool],
};
```

### Step 6: (Optional) Configuration schema

```ts
const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    REQUIRED_PARAM: { type: "string", title: "Required Param" },
    OPTIONAL_PARAM: { type: "string", title: "Optional Param" },
  },
  required: ["REQUIRED_PARAM"],
} as const;
```

### Step 7: Create the MCP SDK server and start Toolception

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// You own the SDK server; pass a factory into Toolception (required in DYNAMIC mode)
const createServer = () =>
  new McpServer({
    name: "my-mcp-server",
    version: "0.0.0",
    capabilities: { tools: { listChanged: true } },
  });

const { start, close } = await createMcpServer({
  catalog,
  moduleLoaders,
  startup: { mode: "DYNAMIC" },
  http: { port: 3000 },
  createServer,
  // configSchema, // uncomment to expose at /.well-known/mcp-config
});
await start();
```

### Step 8: Graceful shutdown

```ts
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

Enable some or ALL toolsets at bootstrap. Note: provide a server or factory:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const staticCatalog = {
  search: { name: "Search", description: "Search tools", modules: ["search"] },
  quotes: { name: "Quotes", description: "Market quotes", modules: ["quotes"] },
};

createMcpServer({
  catalog: staticCatalog,
  startup: { mode: "STATIC", toolsets: ["search", "quotes"] },
  http: { port: 3001 },
  server: new McpServer({
    name: "static-1",
    version: "0.0.0",
    capabilities: { tools: { listChanged: false } },
  }),
});

createMcpServer({
  catalog: staticCatalog,
  startup: { mode: "STATIC", toolsets: "ALL" },
  http: { port: 3002 },
  server: new McpServer({
    name: "static-2",
    version: "0.0.0",
    capabilities: { tools: { listChanged: false } },
  }),
});
```

## API

### createMcpServer(options)

Wires your MCP SDK server to dynamic/static tool management and a Fastify HTTP transport.

Requirements

- Either `server` or `createServer` must be provided.
- In DYNAMIC mode, `createServer` is required (per-client isolation). Passing only `server` will throw.

#### options.catalog (required)

`Record<string, ToolSetDefinition>`

- Defines available toolsets to expose. Each item includes `name`, `description`, optional inline `tools`, optional `modules` (for lazy loaders), and optional `decisionCriteria`.

#### options.moduleLoaders (optional)

`Record<string, ModuleLoader>`

- Maps module keys to async loaders returning `McpToolDefinition[]`. Referenced by toolsets via `modules: [key]`.

#### options.startup (optional)

`{ mode?: "DYNAMIC" | "STATIC"; toolsets?: string[] | "ALL" }`

- Controls startup behavior. In STATIC mode, pre-load specific toolsets (or ALL). In DYNAMIC, register meta-tools and load on demand.

#### options.registerMetaTools (optional)

`boolean` (default: true in DYNAMIC mode; false in STATIC unless explicitly set)

- Whether to register management tools like `enable_toolset`, `disable_toolset`, `list_tools`.

#### options.exposurePolicy (optional)

`ExposurePolicy`

- Limits and namespacing for registered tools (e.g., `maxActiveToolsets`, `namespaceToolsWithSetKey`, `allowlist`/`denylist`).

#### options.context (optional)

`unknown`

- Arbitrary context passed to `moduleLoaders` during tool resolution.

#### options.http (optional)

`{ host?: string; port?: number; basePath?: string; cors?: boolean; logger?: boolean }`

- Fastify transport configuration. Defaults: host `0.0.0.0`, port `3000`, basePath `/`, CORS enabled, logger disabled.

#### options.server (optional)

`McpServer`

- A pre-created SDK server instance to use.

#### options.createServer (optional)

`() => McpServer`

- Factory to create a fresh SDK server for each client bundle. If omitted, `options.server` is reused.

<details>
<summary><strong>Validation and diagnostics</strong></summary>

![Error](https://img.shields.io/badge/Validation-Error-red) Required inputs

- <strong>Error</strong>: neither `server` nor `createServer` provided.

```text
createMcpServer: either `server` or `createServer` must be provided
```

- <strong>Error</strong>: `startup.mode === "DYNAMIC"` without `createServer`.

```text
createMcpServer: in DYNAMIC mode `createServer` is required to create per-client server instances
```

![Warning](https://img.shields.io/badge/Validation-Warning-yellow)

- <strong>Warning</strong>: both `server` and `createServer` provided. The base instance uses `server`; per-client bundles use `createServer`.

```text
[TOOLCEPTION_CREATE_MCP_SERVER_BOTH] Both `server` and `createServer` were provided. The base instance will use `server`, and per-client bundles will use `createServer`.
```

</details>

#### options.configSchema (optional)

`object`

- JSON Schema exposed at `GET /.well-known/mcp-config` for client discovery.

### Meta-tools

Enabled by default when mode is DYNAMIC (or when `registerMetaTools` is true):

- `enable_toolset`, `disable_toolset`, `list_tools`
  Only in DYNAMIC mode:
- `list_toolsets`, `describe_toolset`

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
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: { headers: { "mcp-client-id": clientId } },
  }
);

// High-level MCP client
const client = new Client({ name: "example-client", version: "1.0.0" });

// Connect negotiates capabilities and establishes a session. Transport handles session id.
await client.connect(transport);

// Call a tool (example)
const res = await client.listTools();
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
const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: { headers: { "mcp-client-id": clientId } },
  }
);

const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);

// Session id is handled by the transport. No need to manually set mcp-session-id.

// Call tools
await client.callTool({ name: "enable_toolset", arguments: { name: "core" } });
const ping = await client.callTool({ name: "core.ping", arguments: {} });
console.log(ping);

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

## License

Apache-2.0. See `LICENSE` for details.
