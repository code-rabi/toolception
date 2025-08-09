// Run with: npx --yes tsx examples/static-startup.ts
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
};

const moduleLoaders: Record<string, ModuleLoader> = {
  search: async () => [
    {
      name: "find",
      description: "Simple search placeholder",
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
      handler: async ({ q }: { q: string }) => ({
        content: [{ type: "text", text: `query=${q}` }],
      }),
    },
  ],
  quotes: async () => [
    {
      name: "price",
      description: "Return fake price",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
      },
      handler: async ({ symbol }: { symbol: string }) => ({
        content: [{ type: "text", text: `${symbol}: 123.45` }],
      }),
    },
  ],
};

const { start, close } = await createMcpServer({
  catalog,
  moduleLoaders,
  startup: { mode: "STATIC", toolsets: ["search", "quotes"] },
  registerMetaTools: false,
  http: { port: 3001 },
  mcp: { name: "toolception-static", version: "0.1.0" },
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
console.log("Server started on http://localhost:3001");

const shutdown = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
