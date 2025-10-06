import { createPermissionBasedMcpServer } from "../../src/permissions/createPermissionBasedMcpServer.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolSetCatalog, ModuleLoader } from "../../src/types/index.js";
import { z } from "zod";

/**
 * Smoke test server demonstrating header-based permission control.
 * 
 * This server reads permissions from the 'mcp-toolset-permissions' header.
 * Clients must provide a comma-separated list of toolsets they want to access.
 * 
 * Example header: mcp-toolset-permissions: math,text
 */

// Test catalog with multiple toolsets for permission testing
const catalog: ToolSetCatalog = {
  math: {
    name: "Math Tools",
    description: "Mathematical operations",
    tools: [
      {
        name: "add",
        description: "Add two numbers",
        inputSchema: {
          a: z.number().describe("First number"),
          b: z.number().describe("Second number"),
        } as any,
        handler: async (args: unknown) => {
          const { a, b } = args as { a: number; b: number };
          return {
            content: [{ type: "text", text: `${a + b}` }],
          };
        },
      },
    ],
  },
  text: {
    name: "Text Tools",
    description: "Text manipulation utilities",
    tools: [
      {
        name: "uppercase",
        description: "Convert text to uppercase",
        inputSchema: {
          text: z.string().describe("Text to convert"),
        } as any,
        handler: async (args: unknown) => {
          const { text } = args as { text: string };
          return {
            content: [{ type: "text", text: text.toUpperCase() }],
          };
        },
      },
    ],
  },
  data: {
    name: "Data Tools",
    description: "Data processing tools",
    modules: ["data"],
  },
};

const moduleLoaders: Record<string, ModuleLoader> = {
  data: async () => [
    {
      name: "reverse",
      description: "Reverse a string",
      inputSchema: { text: z.string().describe("Text to reverse") } as any,
      handler: async (args: unknown) => {
        const { text } = args as { text: string };
        return {
          content: [{ type: "text", text: text.split("").reverse().join("") }],
        } as any;
      },
    },
  ],
};

const PORT = Number(process.env.PORT ?? 3004);

/**
 * Creates SDK server instances for each client.
 * Each client gets a fresh server instance with their specific permissions.
 */
const createServer = () =>
  new McpServer({
    name: "toolception-permission-header-demo",
    version: "0.1.0",
    capabilities: { tools: {} }, // STATIC mode, no listChanged
  });

const { start, close } = await createPermissionBasedMcpServer({
  catalog,
  moduleLoaders,
  permissions: {
    source: "headers",
    headerName: "mcp-toolset-permissions", // This is the default, but shown explicitly
  },
  http: { port: PORT },
  createServer,
  configSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      DEMO_CONFIG: {
        type: "string",
        title: "Demo configuration",
        description: "Optional demo config value",
      },
    },
    required: [],
  },
});

await start();
console.log(`Permission-based server (header mode) started on http://localhost:${PORT}`);
console.log("Endpoints:");
console.log("- GET /healthz");
console.log("- GET /tools");
console.log("- GET /.well-known/mcp-config");
console.log("- POST /mcp (JSON-RPC), GET /mcp (SSE), DELETE /mcp");
console.log("");
console.log("Permission Mode: HEADERS");
console.log("Header Name: mcp-toolset-permissions");
console.log("Available Toolsets: math, text, data");
console.log("");
console.log("Example usage:");
console.log('  curl -H "mcp-toolset-permissions: math,text" http://localhost:' + PORT + '/tools');

const shutdown = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
