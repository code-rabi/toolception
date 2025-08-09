# Toolception – Dynamic MCP Tooling Library

## Quickstart

Install peers (consumers):

```bash
npm i @modelcontextprotocol/sdk zod fastify
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
  mcp: { name: "my-mcp-server", version: "0.1.0" },
  configSchema,
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

Enable some or ALL toolsets at bootstrap (meta-tools off by default in STATIC):

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

See `examples/` for runnable snippets. See `agents.md` for LLM/agent-oriented guidance.

## API

- createMcpServer(options): creates an MCP server with dynamic/static tool management and Fastify transport.
  - catalog: Record<string, { name, description, tools?: McpToolDefinition[], modules?: string[] }>
  - moduleLoaders?: Record<string, ModuleLoader> (returns McpToolDefinition[] for MCP server)
  - startup?: { mode: "DYNAMIC" | "STATIC"; toolsets?: string[] | "ALL" }
  - registerMetaTools?: boolean
  - http?: { host?, port?, basePath?, cors?, logger? }
  - mcp?: { name?, version?, capabilities? } (listChanged is computed internally)
  - configSchema?: object (served at /.well-known/mcp-config)

Meta-tools (enabled by default in DYNAMIC):

- enable_toolset, disable_toolset, list_toolsets, describe_toolset, list_tools

## Tool types

- Direct tools: defined inline under `catalog[toolset].tools` and registered immediately when that toolset is enabled.
- Module-produced tools: returned by `moduleLoaders[moduleKey]()` and registered when any toolset referencing that `moduleKey` is enabled.

Use direct tools for simple/local utilities; use module-produced tools to share tools across multiple toolsets or lazily load heavier definitions.

Note on dynamic mode: Both direct and module-produced tools are supported. Module-produced tools are recommended (not required) to minimize startup footprint and enable truly on-demand loading.

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
