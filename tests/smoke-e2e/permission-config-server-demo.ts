import { createPermissionBasedMcpServer } from "../../src/permissions/createPermissionBasedMcpServer.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolSetCatalog, ModuleLoader } from "../../src/types/index.js";
import { z } from "zod";

/**
 * Smoke test server demonstrating config-based permission control.
 * 
 * This server uses server-side permission configuration with:
 * - Static map for known clients
 * - Resolver function for dynamic permission logic
 * - Default permissions for unknown clients
 */

// Test catalog with multiple toolsets for permission testing
const catalog: ToolSetCatalog = {
  admin: {
    name: "Admin Tools",
    description: "Administrative operations",
    tools: [
      {
        name: "reset",
        description: "Reset system state",
        inputSchema: {} as any,
        handler: async () => {
          return {
            content: [{ type: "text", text: "System reset complete" }],
          };
        },
      },
    ],
  },
  user: {
    name: "User Tools",
    description: "Standard user operations",
    tools: [
      {
        name: "profile",
        description: "Get user profile",
        inputSchema: {
          userId: z.string().describe("User ID"),
        } as any,
        handler: async (args: unknown) => {
          const { userId } = args as { userId: string };
          return {
            content: [{ type: "text", text: `Profile for user: ${userId}` }],
          };
        },
      },
    ],
  },
  analytics: {
    name: "Analytics Tools",
    description: "Data analytics and reporting",
    modules: ["analytics"],
  },
};

const moduleLoaders: Record<string, ModuleLoader> = {
  analytics: async () => [
    {
      name: "report",
      description: "Generate analytics report",
      inputSchema: {
        type: z.string().describe("Report type"),
      } as any,
      handler: async (args: unknown) => {
        const { type } = args as { type: string };
        return {
          content: [{ type: "text", text: `Analytics report: ${type}` }],
        } as any;
      },
    },
  ],
};

const PORT = Number(process.env.PORT ?? 3005);

/**
 * Creates SDK server instances for each client.
 * Each client gets a fresh server instance with their specific permissions.
 */
const createServer = () =>
  new McpServer({
    name: "toolception-permission-config-demo",
    version: "0.1.0",
    capabilities: { tools: {} }, // STATIC mode, no listChanged
  });

/**
 * Static permission map for known clients.
 * Maps client IDs to their allowed toolsets.
 */
const staticPermissionMap: Record<string, string[]> = {
  "admin-user": ["admin", "user", "analytics"],
  "regular-user": ["user"],
  "analyst-user": ["user", "analytics"],
};

/**
 * Resolver function for dynamic permission logic.
 * This is called FIRST, before checking the static map.
 * Return a valid array to use those permissions, or throw an error to fall back to static map.
 * 
 * @param clientId - The client identifier
 * @returns Array of allowed toolset names, or throws to trigger fallback
 */
const permissionResolver = (clientId: string): string[] => {
  console.log(`Resolver called for client: ${clientId}`);

  // Example: Grant permissions based on client ID patterns
  if (clientId.startsWith("admin-")) {
    console.log(`Matched admin-* pattern`);
    return ["admin", "user", "analytics"];
  }
  if (clientId.startsWith("analyst-")) {
    console.log(`Matched analyst-* pattern`);
    return ["user", "analytics"];
  }
  if (clientId.startsWith("user-")) {
    console.log(`Matched user-* pattern`);
    return ["user"];
  }

  // No pattern match - throw error to fall back to static map or default permissions
  console.log(`No pattern match for ${clientId}, falling back to static map`);
  throw new Error(`No resolver pattern match for ${clientId}`);
};

const { start, close } = await createPermissionBasedMcpServer({
  catalog,
  moduleLoaders,
  permissions: {
    source: "config",
    staticMap: staticPermissionMap,
    resolver: permissionResolver,
    defaultPermissions: ["user"], // Fallback for unknown clients
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
console.log(`Permission-based server (config mode) started on http://localhost:${PORT}`);
console.log("Endpoints:");
console.log("- GET /healthz");
console.log("- GET /tools");
console.log("- GET /.well-known/mcp-config");
console.log("- POST /mcp (JSON-RPC), GET /mcp (SSE), DELETE /mcp");
console.log("");
console.log("Permission Mode: CONFIG");
console.log("Available Toolsets: admin, user, analytics");
console.log("");
console.log("Static Map Clients:");
console.log("  - admin-user: admin, user, analytics");
console.log("  - regular-user: user");
console.log("  - analyst-user: user, analytics");
console.log("");
console.log("Resolver Function Patterns:");
console.log("  - admin-*: admin, user, analytics");
console.log("  - analyst-*: user, analytics");
console.log("  - user-*: user");
console.log("");
console.log("Default Permissions: user");
console.log("");
console.log("Example usage:");
console.log('  curl -H "mcp-client-id: admin-user" http://localhost:' + PORT + '/tools');

const shutdown = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
