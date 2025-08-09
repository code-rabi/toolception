# Toolception – Dynamic MCP Tooling Library

## Quickstart

Install peers (consumers):

```bash
npm i @modelcontextprotocol/sdk zod fastify
```

Create a server with dynamic tool management (Fastify transport included):

```ts
import { createMcpServer } from "toolception";

const { server, start, close } = await createMcpServer({
  catalog: {
    /* ... */
  },
  moduleLoaders: {
    quotes: async () => [
      {
        name: "price",
        description: "Return a fake price",
        inputSchema: {
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
        },
        handler: async ({ symbol }) => ({
          content: [{ type: "text", text: `${symbol}: 123.45` }],
        }),
      },
    ],
  },
  startup: { mode: "DYNAMIC" },
  http: { port: 3000 },
  mcp: { name: "my-mcp-server", version: "0.1.0" },
  configSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      FMP_ACCESS_TOKEN: { type: "string", title: "FMP Access Token" },
      FMP_TOOL_SETS: { type: "string", title: "Tool Sets (Optional)" },
      DYNAMIC_TOOL_DISCOVERY: {
        type: "string",
        title: "Dynamic Tool Discovery (Optional)",
      },
    },
  },
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
createMcpServer({
  catalog,
  startup: { mode: "STATIC", toolsets: ["search", "quotes"] },
  http: { port: 3001 },
});

createMcpServer({
  catalog,
  startup: { mode: "STATIC", toolsets: "ALL" },
  http: { port: 3002 },
});
```

See `examples/` for runnable snippets. See `agents.md` for LLM/agent-oriented guidance.

## API

- createMcpServer(options): creates an MCP server with dynamic/static tool management and Fastify transport.
  - catalog: Record<string, { name, description, tools?: McpToolDefinition[], modules?: string[] }>
  - moduleLoaders?: Record<string, ModuleLoader>
  - startup?: { mode: "DYNAMIC" | "STATIC"; toolsets?: string[] | "ALL" }
  - registerMetaTools?: boolean
  - http?: { host?, port?, basePath?, cors?, logger? }
  - mcp?: { name?, version?, capabilities? } (listChanged is computed internally)
  - configSchema?: object (served at /.well-known/mcp-config)

Meta-tools (enabled by default in DYNAMIC):

- enable_toolset, disable_toolset, list_toolsets, describe_toolset, list_tools

## Examples

- See `examples/` for runnable scripts:
  - `npx --yes tsx examples/basic.ts`
  - `npx --yes tsx examples/static-startup.ts`
  - `npx --yes tsx examples/static-all.ts`
