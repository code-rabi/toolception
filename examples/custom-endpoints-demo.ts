#!/usr/bin/env tsx

/**
 * Example server demonstrating custom endpoint functionality.
 *
 * This example shows:
 * - Basic GET/POST/PUT/DELETE endpoints with Zod validation
 * - Query parameter validation and coercion
 * - Path parameter validation
 * - Request body validation
 * - Response validation
 * - Client ID extraction
 * - Permission-aware endpoints
 *
 * Run this example with:
 *   npx tsx examples/custom-endpoints-demo.ts
 *
 * Then test the endpoints with curl:
 *   curl "http://localhost:3000/api/users?limit=5"
 *   curl -X POST http://localhost:3000/api/users -H 'Content-Type: application/json' -d '{"name":"Alice","email":"alice@example.com"}'
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createMcpServer,
  createPermissionBasedMcpServer,
  defineEndpoint,
  definePermissionAwareEndpoint,
} from "../src/index.js";

// ============================================================================
// Example 1: Standard Server with Custom Endpoints
// ============================================================================

async function runStandardServerExample() {
  console.log("\n🚀 Starting Standard MCP Server with Custom Endpoints\n");

  const server = await createMcpServer({
    createServer: () =>
      new McpServer({
        name: "custom-endpoints-demo",
        version: "1.0.0",
      }),
    catalog: {
      // Example toolset - not the focus of this demo
      "greeting-tools": {
        name: "Greeting Tools",
        description: "Simple greeting tools",
        tools: [
          {
            name: "greet",
            description: "Greet a user",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
              required: ["name"],
            },
            handler: async (args: any) => ({
              content: [
                {
                  type: "text",
                  text: `Hello, ${args.name}!`,
                },
              ],
            }),
          },
        ],
      },
    },
    startup: {
      mode: "STATIC",
      toolsets: ["greeting-tools"],
    },
    http: {
      port: 3000,
      customEndpoints: [
        // ====================================================================
        // GET endpoint with query parameter validation
        // ====================================================================
        defineEndpoint({
          method: "GET",
          path: "/api/users",
          description: "Get a list of users with pagination",
          querySchema: z.object({
            // Coerce string to number (query params are always strings)
            limit: z.coerce.number().int().positive().max(100).default(10),
            offset: z.coerce.number().int().nonnegative().default(0),
            // Optional filter
            role: z.enum(["admin", "user", "guest"]).optional(),
            // Search query
            search: z.string().optional(),
          }),
          responseSchema: z.object({
            users: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                email: z.string().email(),
                role: z.string(),
              })
            ),
            pagination: z.object({
              limit: z.number(),
              offset: z.number(),
              total: z.number(),
            }),
          }),
          handler: async (req) => {
            console.log(
              `📥 GET /api/users - Client: ${req.clientId}, Query:`,
              req.query
            );

            // Mock database
            const allUsers = [
              {
                id: "1",
                name: "Alice Johnson",
                email: "alice@example.com",
                role: "admin",
              },
              {
                id: "2",
                name: "Bob Smith",
                email: "bob@example.com",
                role: "user",
              },
              {
                id: "3",
                name: "Charlie Brown",
                email: "charlie@example.com",
                role: "user",
              },
              {
                id: "4",
                name: "Diana Prince",
                email: "diana@example.com",
                role: "guest",
              },
            ];

            // Filter by role
            let filtered = req.query.role
              ? allUsers.filter((u) => u.role === req.query.role)
              : allUsers;

            // Filter by search
            if (req.query.search) {
              const searchLower = req.query.search.toLowerCase();
              filtered = filtered.filter(
                (u) =>
                  u.name.toLowerCase().includes(searchLower) ||
                  u.email.toLowerCase().includes(searchLower)
              );
            }

            // Paginate
            const users = filtered.slice(
              req.query.offset,
              req.query.offset + req.query.limit
            );

            return {
              users,
              pagination: {
                limit: req.query.limit,
                offset: req.query.offset,
                total: filtered.length,
              },
            };
          },
        }),

        // ====================================================================
        // POST endpoint with body validation
        // ====================================================================
        defineEndpoint({
          method: "POST",
          path: "/api/users",
          description: "Create a new user",
          bodySchema: z.object({
            name: z.string().min(1, "Name is required").max(100),
            email: z.string().email("Invalid email address"),
            role: z.enum(["admin", "user", "guest"]).default("user"),
            age: z.number().int().positive().optional(),
          }),
          responseSchema: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            role: z.string(),
            createdAt: z.string().datetime(),
          }),
          handler: async (req) => {
            console.log(
              `📥 POST /api/users - Client: ${req.clientId}, Body:`,
              req.body
            );

            // Simulate database insert
            const newUser = {
              id: `user-${Date.now()}`,
              name: req.body.name,
              email: req.body.email,
              role: req.body.role,
              createdAt: new Date().toISOString(),
            };

            return newUser;
          },
        }),

        // ====================================================================
        // GET endpoint with path parameters
        // ====================================================================
        defineEndpoint({
          method: "GET",
          path: "/api/users/:userId",
          description: "Get a user by ID",
          paramsSchema: z.object({
            userId: z.string().min(1, "User ID is required"),
          }),
          responseSchema: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            role: z.string(),
          }),
          handler: async (req) => {
            console.log(
              `📥 GET /api/users/:userId - Client: ${req.clientId}, UserId: ${req.params.userId}`
            );

            // Simulate database lookup
            return {
              id: req.params.userId,
              name: "Example User",
              email: "user@example.com",
              role: "user",
            };
          },
        }),

        // ====================================================================
        // PUT endpoint for updates
        // ====================================================================
        defineEndpoint({
          method: "PUT",
          path: "/api/users/:userId",
          description: "Update a user",
          paramsSchema: z.object({
            userId: z.string(),
          }),
          bodySchema: z.object({
            name: z.string().min(1).optional(),
            email: z.string().email().optional(),
            role: z.enum(["admin", "user", "guest"]).optional(),
          }),
          responseSchema: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            role: z.string(),
            updatedAt: z.string().datetime(),
          }),
          handler: async (req) => {
            console.log(
              `📥 PUT /api/users/:userId - Client: ${req.clientId}, UserId: ${req.params.userId}, Body:`,
              req.body
            );

            return {
              id: req.params.userId,
              name: req.body.name || "Example User",
              email: req.body.email || "user@example.com",
              role: req.body.role || "user",
              updatedAt: new Date().toISOString(),
            };
          },
        }),

        // ====================================================================
        // DELETE endpoint
        // ====================================================================
        defineEndpoint({
          method: "DELETE",
          path: "/api/users/:userId",
          description: "Delete a user",
          paramsSchema: z.object({
            userId: z.string(),
          }),
          responseSchema: z.object({
            success: z.boolean(),
            deletedId: z.string(),
            deletedAt: z.string().datetime(),
          }),
          handler: async (req) => {
            console.log(
              `📥 DELETE /api/users/:userId - Client: ${req.clientId}, UserId: ${req.params.userId}`
            );

            return {
              success: true,
              deletedId: req.params.userId,
              deletedAt: new Date().toISOString(),
            };
          },
        }),

        // ====================================================================
        // Status endpoint showing client ID access
        // ====================================================================
        defineEndpoint({
          method: "GET",
          path: "/api/status",
          description: "Get server status and client info",
          responseSchema: z.object({
            status: z.string(),
            clientId: z.string(),
            timestamp: z.number(),
            version: z.string(),
          }),
          handler: async (req) => {
            console.log(`📥 GET /api/status - Client: ${req.clientId}`);

            return {
              status: "ok",
              clientId: req.clientId,
              timestamp: Date.now(),
              version: "1.0.0",
            };
          },
        }),
      ],
    },
  });

  await server.start();

  console.log("✅ Server started on http://localhost:3000\n");
  console.log("📍 Available Custom Endpoints:");
  console.log("  GET    /api/users          - List users with pagination");
  console.log("  POST   /api/users          - Create a new user");
  console.log("  GET    /api/users/:userId  - Get a specific user");
  console.log("  PUT    /api/users/:userId  - Update a user");
  console.log("  DELETE /api/users/:userId  - Delete a user");
  console.log("  GET    /api/status         - Server status\n");

  console.log("📍 Built-in MCP Endpoints:");
  console.log("  GET    /healthz            - Health check");
  console.log("  GET    /tools              - Available toolsets");
  console.log("  POST   /mcp                - MCP JSON-RPC endpoint\n");

  console.log("💡 Example curl commands:");
  console.log(
    '\n  # List users\n  curl "http://localhost:3000/api/users"'
  );
  console.log(
    '\n  # List users with pagination and filtering\n  curl "http://localhost:3000/api/users?limit=2&offset=0&role=user"'
  );
  console.log(
    '\n  # Search users\n  curl "http://localhost:3000/api/users?search=alice"'
  );
  console.log(
    "\n  # Create a user\n  curl -X POST http://localhost:3000/api/users \\\n    -H 'Content-Type: application/json' \\\n    -d '{\"name\":\"Alice\",\"email\":\"alice@example.com\",\"role\":\"admin\"}'"
  );
  console.log(
    '\n  # Get a user\n  curl "http://localhost:3000/api/users/123"'
  );
  console.log(
    "\n  # Update a user\n  curl -X PUT http://localhost:3000/api/users/123 \\\n    -H 'Content-Type: application/json' \\\n    -d '{\"name\":\"Alice Updated\"}'"
  );
  console.log(
    '\n  # Delete a user\n  curl -X DELETE "http://localhost:3000/api/users/123"'
  );
  console.log(
    '\n  # Check status\n  curl "http://localhost:3000/api/status"'
  );
  console.log(
    '\n  # Check status with custom client ID\n  curl "http://localhost:3000/api/status" -H "mcp-client-id: my-client"'
  );
  console.log(
    '\n  # Test validation error\n  curl -X POST http://localhost:3000/api/users \\\n    -H \'Content-Type: application/json\' \\\n    -d \'{"name":"","email":"invalid-email"}\''
  );

  console.log("\n\n⌛ Server running. Press Ctrl+C to stop.\n");

  // Keep the process running
  await new Promise(() => {});
}

// ============================================================================
// Example 2: Permission-Based Server with Custom Endpoints
// ============================================================================

async function runPermissionBasedServerExample() {
  console.log(
    "\n🚀 Starting Permission-Based MCP Server with Custom Endpoints\n"
  );

  const server = await createPermissionBasedMcpServer({
    createServer: () =>
      new McpServer({
        name: "permission-demo",
        version: "1.0.0",
      }),
    catalog: {
      "admin-tools": {
        name: "Admin Tools",
        description: "Administrative tools",
        tools: [
          {
            name: "admin-action",
            description: "Perform admin action",
            inputSchema: { type: "object", properties: {} },
            handler: async () => ({
              content: [{ type: "text", text: "Admin action completed" }],
            }),
          },
        ],
      },
      "user-tools": {
        name: "User Tools",
        description: "User tools",
        tools: [
          {
            name: "user-action",
            description: "Perform user action",
            inputSchema: { type: "object", properties: {} },
            handler: async () => ({
              content: [{ type: "text", text: "User action completed" }],
            }),
          },
        ],
      },
    },
    permissions: {
      source: "config",
      staticMap: {
        "admin-client": ["admin-tools", "user-tools"],
        "user-client": ["user-tools"],
        "guest-client": [],
      },
      defaultPermissions: [],
    },
    http: {
      port: 3001,
      customEndpoints: [
        // Permission-aware endpoint
        definePermissionAwareEndpoint({
          method: "GET",
          path: "/api/me",
          description: "Get current client permissions",
          responseSchema: z.object({
            clientId: z.string(),
            allowedToolsets: z.array(z.string()),
            failedToolsets: z.array(z.string()),
            isAdmin: z.boolean(),
          }),
          handler: async (req) => {
            console.log(
              `📥 GET /api/me - Client: ${req.clientId}, Toolsets: [${req.allowedToolsets.join(", ")}]`
            );

            return {
              clientId: req.clientId,
              allowedToolsets: req.allowedToolsets,
              failedToolsets: req.failedToolsets,
              isAdmin: req.allowedToolsets.includes("admin-tools"),
            };
          },
        }),

        // Admin-only endpoint
        definePermissionAwareEndpoint({
          method: "POST",
          path: "/api/admin/users/:userId/ban",
          description: "Ban a user (admin only)",
          paramsSchema: z.object({
            userId: z.string(),
          }),
          bodySchema: z.object({
            reason: z.string().min(1),
          }),
          responseSchema: z.object({
            success: z.boolean(),
            userId: z.string(),
            reason: z.string(),
          }),
          handler: async (req) => {
            console.log(
              `📥 POST /api/admin/users/:userId/ban - Client: ${req.clientId}`
            );

            // Check permissions
            if (!req.allowedToolsets.includes("admin-tools")) {
              throw new Error("Access denied: admin-tools required");
            }

            return {
              success: true,
              userId: req.params.userId,
              reason: req.body.reason,
            };
          },
        }),
      ],
    },
  });

  await server.start();

  console.log("✅ Permission server started on http://localhost:3001\n");
  console.log("📍 Available Custom Endpoints:");
  console.log("  GET  /api/me                       - Get permissions");
  console.log("  POST /api/admin/users/:userId/ban  - Ban user (admin only)\n");

  console.log("💡 Example curl commands:");
  console.log(
    '\n  # Get admin permissions\n  curl "http://localhost:3001/api/me" -H "mcp-client-id: admin-client"'
  );
  console.log(
    '\n  # Get user permissions\n  curl "http://localhost:3001/api/me" -H "mcp-client-id: user-client"'
  );
  console.log(
    '\n  # Ban user as admin (succeeds)\n  curl -X POST "http://localhost:3001/api/admin/users/123/ban" \\\n    -H "mcp-client-id: admin-client" \\\n    -H "Content-Type: application/json" \\\n    -d \'{"reason":"Spam"}\''
  );
  console.log(
    '\n  # Ban user as regular user (fails)\n  curl -X POST "http://localhost:3001/api/admin/users/123/ban" \\\n    -H "mcp-client-id: user-client" \\\n    -H "Content-Type: application/json" \\\n    -d \'{"reason":"Spam"}\''
  );

  console.log("\n\n⌛ Server running. Press Ctrl+C to stop.\n");

  await new Promise(() => {});
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);
const mode = args[0] || "standard";

if (mode === "permission") {
  runPermissionBasedServerExample().catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
} else {
  runStandardServerExample().catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
}
