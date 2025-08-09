// Run with: npx --yes tsx local-server-tests/server-demo.ts
import { createMcpServer } from "../src/server/createMcpServer.js";
import type { ToolSetCatalog, ModuleLoader } from "../src/types/index.js";

// Minimal demo catalog with one direct toolset and one module-derived toolset
const catalog: ToolSetCatalog = {
  core: {
    name: "Core",
    description: "Core utilities",
    tools: [
      {
        name: "ping",
        description: "Responds with pong",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
      },
    ],
  },
  ext: { name: "Extensions", description: "Extra tools", modules: ["ext"] },
};

const moduleLoaders: Record<string, ModuleLoader> = {
  ext: async () => [
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

const PORT = Number(process.env.PORT ?? 3003);

const { start, close } = await createMcpServer({
  catalog,
  moduleLoaders,
  startup: { mode: "DYNAMIC" },
  http: { port: PORT },
  mcp: { name: "toolception-server-demo", version: "0.1.0" },
  configSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      SAMPLE_OPTIONAL: {
        type: "string",
        title: "Optional setting",
        description: "An optional demo config value",
      },
    },
    required: [],
  },
});

await start();
console.log(`Server started on http://localhost:${PORT}`);
console.log("Endpoints:");
console.log("- GET /healthz");
console.log("- GET /tools");
console.log("- GET /.well-known/mcp-config");
console.log("- POST /mcp (JSON-RPC), GET /mcp (SSE), DELETE /mcp");

const shutdown = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
