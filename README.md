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

- `createServer` must be provided.
- In DYNAMIC mode, a fresh server instance is created per client via `createServer`.
- In STATIC mode, a single server instance is created once via `createServer` and reused for all clients.

#### options.catalog (required)

`Record<string, ToolSetDefinition>`

- Defines available toolsets to expose. Each item includes `name`, `description`, optional inline `tools`, optional `modules` (for lazy loaders), and optional `decisionCriteria`.

#### options.moduleLoaders (optional)

`Record<string, ModuleLoader>`

- Maps module keys to async loaders returning `McpToolDefinition[]`. Referenced by toolsets via `modules: [key]`.

Usage and behavior

| Aspect           | Details                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key naming       | The object key is the module identifier referenced in `catalog[toolset].modules`. Example: `{ ext: async () => [...] }` and `modules: ["ext"]`.          |
| Loader signature | `(context?: unknown) => Promise<McpToolDefinition[]>` or `McpToolDefinition[]`                                                                           |
| When called      | STATIC mode: at startup (for specified toolsets or ALL). DYNAMIC mode: when a toolset is enabled via meta-tools.                                         |
| Return value     | An array of tools to register. Tool names should be unique per toolset; if `namespaceToolsWithSetKey` is true, names are prefixed at registration.       |
| Errors           | Throwing rejects the enable/preload flow for that toolset and surfaces an error to the caller.                                                           |
| Idempotency      | Loaders may be invoked multiple times across runs/clients. Keep them deterministic/idempotent. Implement internal caching if they perform expensive I/O. |

Example

```ts
const moduleLoaders = {
  ext: async (ctx?: unknown) => [
    {
      name: "echo",
      description: "Echo back provided text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      handler: async ({ text }: { text: string }) => ({
        content: [{ type: "text", text }],
      }),
    },
  ],
};

const catalog = {
  ext: { name: "Extensions", description: "Extra tools", modules: ["ext"] },
};
```

#### options.startup (optional)

`{ mode?: "DYNAMIC" | "STATIC"; toolsets?: string[] | "ALL" }`

- Controls startup behavior. In STATIC mode, pre-load specific toolsets (or ALL). In DYNAMIC, register meta-tools and load on demand.

Startup precedence and validation

| Input                                                | Effective mode | Toolset handling                    | Outcome/Notes                                                                    |
| ---------------------------------------------------- | -------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `startup.mode = "DYNAMIC"` (toolsets present or not) | DYNAMIC        | `startup.toolsets` is ignored       | Manage toolsets at runtime via meta-tools; logs a warning if `toolsets` provided |
| `startup.mode = "STATIC"`, `toolsets = "ALL"`        | STATIC         | Preload all toolsets from `catalog` | OK                                                                               |
| `startup.mode = "STATIC"`, `toolsets = [names]`      | STATIC         | Validate names against `catalog`    | Invalid names warn; if none valid remain → error                                 |
| No `startup.mode`, `toolsets = "ALL"`                | STATIC         | Preload all toolsets                | OK                                                                               |
| No `startup.mode`, `toolsets = [names]`              | STATIC         | Validate names against `catalog`    | Invalid names warn; if none valid remain → error                                 |
| No `startup.mode`, no `toolsets`                     | DYNAMIC        | No preloads                         | Default behavior; manage toolsets at runtime via meta-tools                      |

#### options.registerMetaTools (optional)

`boolean` (default: true in DYNAMIC mode; false in STATIC unless explicitly set)

- Whether to register management tools like `enable_toolset`, `disable_toolset`, `list_tools`.

#### options.exposurePolicy (optional)

`ExposurePolicy`

- Controls which toolsets can be activated and how tools are named when registered.

| Field                      | Type                          | Purpose                                                                            | Example                                                              |
| -------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `maxActiveToolsets`        | `number`                      | Limit how many toolsets can be active at once. Prevents tool bloat.                | `{ maxActiveToolsets: 1 }` blocks enabling a second toolset          |
| `namespaceToolsWithSetKey` | `boolean`                     | Prefix tool names with the toolset key when registering, to avoid name collisions. | With `true`, enabling `core` registers `core.ping` instead of `ping` |
| `allowlist`                | `string[]`                    | Only these toolsets may be enabled. Others are denied.                             | `{ allowlist: ["core"] }` prevents enabling `ext`                    |
| `denylist`                 | `string[]`                    | These toolsets cannot be enabled.                                                  | `{ denylist: ["ext"] }` blocks `ext`                                 |
| `onLimitExceeded`          | `(attempted, active) => void` | Callback when `maxActiveToolsets` would be exceeded.                               | Log or telemetry hook                                                |

Notes

- Policy is enforced at enable time (via meta-tools or static preload).
- If both `allowlist` and `denylist` are present, the entry must be in `allowlist` and not in `denylist` to pass.
- Namespacing is applied consistently at registration time and reflected in `GET /tools`.

#### options.context (optional)

`unknown`

- Arbitrary context passed to `moduleLoaders` during tool resolution.

| Field     | Type      | Purpose                                                                                      | Example                                                        |
| --------- | --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `context` | `unknown` | Extra data/injectables available to every `ModuleLoader(context)` call when resolving tools. | `{ db, cache, apiClients }` used inside loaders to build tools |

Notes

- Only `moduleLoaders` receive `context`. Direct tools defined inline in `catalog` do not.
- Not exposed to clients over HTTP; it stays in-process on the server.
- Keep it lightweight and stable; prefer passing handles (e.g., db client) rather than huge data blobs.
- STATIC mode: loaders are invoked at startup with the same `context`.
- DYNAMIC mode: loaders are invoked at enable time with the same `context`.

Example

```ts
const moduleLoaders = {
  ext: async (ctx: any) => [
    {
      name: "echo",
      description: "Echo using a backing service",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      handler: async ({ text }: { text: string }) => {
        const result = await ctx.apiClients.echoService.send(text);
        return { content: [{ type: "text", text: result }] } as any;
      },
    },
  ],
};
```

#### options.http (optional)

`{ host?: string; port?: number; basePath?: string; cors?: boolean; logger?: boolean }`

- Fastify transport configuration. Defaults: host `0.0.0.0`, port `3000`, basePath `/`, CORS enabled, logger disabled.

#### options.createServer (optional)

`() => McpServer`

Required factory to create the SDK server instance(s).

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
