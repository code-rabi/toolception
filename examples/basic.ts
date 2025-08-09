// Run with: npx --yes tsx examples/basic.ts
import { createMcpServer } from "../src/server/createMcpServer.js";
import type { ToolSetCatalog, ModuleLoader } from "../src/types/index.js";

// Catalog: one direct toolset and one module-derived toolset
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

const { start, close } = await createMcpServer({
  catalog,
  moduleLoaders,
  startup: { mode: "DYNAMIC" },
  http: { port: 3000 },
  mcp: { name: "toolception-example", version: "0.1.0" },
  configSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      FMP_ACCESS_TOKEN: {
        type: "string",
        title: "FMP Access Token",
        description: "Financial Modeling Prep API access token",
      },
      FMP_TOOL_SETS: {
        type: "string",
        title: "Tool Sets (Optional)",
        description:
          "Comma-separated list of tool sets to load (e.g., 'search,company,quotes'). If not specified, all tools will be loaded.",
      },
      DYNAMIC_TOOL_DISCOVERY: {
        type: "string",
        title: "Dynamic Tool Discovery (Optional)",
        description:
          "Enable dynamic toolset management. Set to 'true' to use meta-tools.",
      },
    },
    required: [],
  },
});

await start();
console.log("Server started on http://localhost:3000");

const shutdown = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
