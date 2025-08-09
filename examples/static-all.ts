// Run with: npx --yes tsx examples/static-all.ts
import { createMcpServer } from "../src/server/createMcpServer.js";
import type { ToolSetCatalog, ModuleLoader } from "../src/types/index.js";

const catalog: ToolSetCatalog = {
  search: { name: "Search", description: "Search tools", modules: ["search"] },
  company: {
    name: "Company",
    description: "Company tools",
    modules: ["company"],
  },
  quotes: { name: "Quotes", description: "Market quotes", modules: ["quotes"] },
  news: { name: "News", description: "News tools", modules: ["news"] },
};

const moduleLoaders: Record<string, ModuleLoader> = {
  search: async () => [
    {
      name: "find",
      description: "find",
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
      handler: async ({ q }: { q: string }) => ({
        content: [{ type: "text", text: `q=${q}` }],
      }),
    },
  ],
  company: async () => [
    {
      name: "profile",
      description: "profile",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
      },
      handler: async ({ symbol }: { symbol: string }) => ({
        content: [{ type: "text", text: `${symbol}` }],
      }),
    },
  ],
  quotes: async () => [
    {
      name: "price",
      description: "price",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
      },
      handler: async ({ symbol }: { symbol: string }) => ({
        content: [{ type: "text", text: `${symbol}: 1.23` }],
      }),
    },
  ],
  news: async () => [
    {
      name: "latest",
      description: "latest",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
      },
      handler: async ({ topic }: { topic: string }) => ({
        content: [{ type: "text", text: `${topic}` }],
      }),
    },
  ],
};

const { start, close } = await createMcpServer({
  catalog,
  moduleLoaders,
  startup: { mode: "STATIC", toolsets: "ALL" },
  registerMetaTools: false,
  http: { port: 3002 },
  mcp: { name: "toolception-static-all", version: "0.1.0" },
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
console.log("Server started on http://localhost:3002");

const shutdown = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
