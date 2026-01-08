import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Fastify, { type FastifyInstance } from "fastify";
import { createMcpServer, defineEndpoint } from "../src/index.js";
import { createPermissionBasedMcpServer, definePermissionAwareEndpoint } from "../src/index.js";

describe("Custom Endpoints Integration", () => {
  describe("Standard MCP Server with Custom Endpoints", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let testApp: FastifyInstance;

    beforeAll(async () => {
      // Create test Fastify instance to avoid port conflicts
      testApp = Fastify({ logger: false });

      server = await createMcpServer({
        createServer: () =>
          new McpServer({ name: "test-server", version: "1.0.0" }),
        catalog: {
          "test-toolset": {
            name: "Test Toolset",
            description: "A test toolset",
            tools: [
              {
                name: "ping",
                description: "Test tool",
                inputSchema: { type: "object", properties: {} },
                handler: async () => ({
                  content: [{ type: "text", text: "pong" }],
                }),
              },
            ],
          },
        },
        startup: {
          mode: "STATIC",
          toolsets: ["test-toolset"],
        },
        http: {
          app: testApp, // Inject Fastify instance for testing
          customEndpoints: [
            // GET endpoint with query validation
            defineEndpoint({
              method: "GET",
              path: "/api/users",
              querySchema: z.object({
                limit: z.coerce.number().int().positive().default(10),
                offset: z.coerce.number().int().nonnegative().default(0),
              }),
              responseSchema: z.object({
                users: z.array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                  })
                ),
                pagination: z.object({
                  limit: z.number(),
                  offset: z.number(),
                }),
              }),
              handler: async (req) => ({
                users: [
                  { id: "1", name: "Alice" },
                  { id: "2", name: "Bob" },
                ].slice(req.query.offset, req.query.offset + req.query.limit),
                pagination: {
                  limit: req.query.limit,
                  offset: req.query.offset,
                },
              }),
            }),

            // POST endpoint with body validation
            defineEndpoint({
              method: "POST",
              path: "/api/users",
              bodySchema: z.object({
                name: z.string().min(1).max(100),
                email: z.string().email(),
                age: z.number().int().positive().optional(),
              }),
              responseSchema: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
                createdAt: z.string(),
              }),
              handler: async (req) => ({
                id: "new-user-id",
                name: req.body.name,
                email: req.body.email,
                createdAt: new Date().toISOString(),
              }),
            }),

            // GET endpoint with path parameters
            defineEndpoint({
              method: "GET",
              path: "/api/users/:userId",
              paramsSchema: z.object({
                userId: z.string(),
              }),
              responseSchema: z.object({
                id: z.string(),
                name: z.string(),
              }),
              handler: async (req) => ({
                id: req.params.userId,
                name: `User ${req.params.userId}`,
              }),
            }),

            // DELETE endpoint
            defineEndpoint({
              method: "DELETE",
              path: "/api/users/:userId",
              paramsSchema: z.object({
                userId: z.string(),
              }),
              responseSchema: z.object({
                success: z.boolean(),
                deletedId: z.string(),
              }),
              handler: async (req) => ({
                success: true,
                deletedId: req.params.userId,
              }),
            }),

            // Status endpoint accessing client ID
            defineEndpoint({
              method: "GET",
              path: "/api/status",
              responseSchema: z.object({
                status: z.string(),
                clientId: z.string(),
                timestamp: z.number(),
              }),
              handler: async (req) => ({
                status: "ok",
                clientId: req.clientId,
                timestamp: Date.now(),
              }),
            }),
          ],
        },
      });

      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("handles GET request with query parameters", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/api/users?limit=5&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.users).toHaveLength(2);
      expect(body.pagination).toEqual({ limit: 5, offset: 0 });
    });

    it("handles POST request with body validation", async () => {
      const response = await testApp.inject({
        method: "POST",
        url: "/api/users",
        payload: {
          name: "Charlie",
          email: "charlie@example.com",
          age: 30,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe("new-user-id");
      expect(body.name).toBe("Charlie");
      expect(body.email).toBe("charlie@example.com");
      expect(body.createdAt).toBeDefined();
    });

    it("handles GET request with path parameters", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/api/users/user-123",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe("user-123");
      expect(body.name).toBe("User user-123");
    });

    it("handles DELETE request", async () => {
      const response = await testApp.inject({
        method: "DELETE",
        url: "/api/users/user-456",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.deletedId).toBe("user-456");
    });

    it("extracts client ID from header", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/api/status",
        headers: {
          "mcp-client-id": "test-client-xyz",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.clientId).toBe("test-client-xyz");
      expect(body.status).toBe("ok");
    });

    it("generates anonymous client ID when header missing", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/api/status",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.clientId).toMatch(/^anon-/);
    });

    it("validates request body and returns error", async () => {
      const response = await testApp.inject({
        method: "POST",
        url: "/api/users",
        payload: {
          name: "",
          email: "invalid-email",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details).toBeDefined();
    });

    it("built-in MCP endpoints still work", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });
  });

  describe("Permission-Based MCP Server with Custom Endpoints", () => {
    let server: Awaited<ReturnType<typeof createPermissionBasedMcpServer>>;
    let testApp: FastifyInstance;

    beforeAll(async () => {
      testApp = Fastify({ logger: false });

      server = await createPermissionBasedMcpServer({
        createServer: () =>
          new McpServer({
            name: "permission-test-server",
            version: "1.0.0",
          }),
        catalog: {
          "admin-toolset": {
            name: "Admin Toolset",
            description: "Admin tools",
            tools: [
              {
                name: "admin-ping",
                description: "Admin test tool",
                inputSchema: { type: "object", properties: {} },
                handler: async () => ({
                  content: [{ type: "text", text: "admin-pong" }],
                }),
              },
            ],
          },
          "user-toolset": {
            name: "User Toolset",
            description: "User tools",
            tools: [
              {
                name: "user-ping",
                description: "User test tool",
                inputSchema: { type: "object", properties: {} },
                handler: async () => ({
                  content: [{ type: "text", text: "user-pong" }],
                }),
              },
            ],
          },
        },
        permissions: {
          source: "config",
          staticMap: {
            "admin-client": ["admin-toolset", "user-toolset"],
            "user-client": ["user-toolset"],
            "guest-client": [],
          },
          defaultPermissions: [],
        },
        http: {
          app: testApp,
          customEndpoints: [
            // Permission-aware endpoint
            definePermissionAwareEndpoint({
              method: "GET",
              path: "/api/permissions",
              responseSchema: z.object({
                clientId: z.string(),
                allowedToolsets: z.array(z.string()),
                failedToolsets: z.array(z.string()),
                isAdmin: z.boolean(),
              }),
              handler: async (req) => ({
                clientId: req.clientId,
                allowedToolsets: req.allowedToolsets,
                failedToolsets: req.failedToolsets,
                isAdmin: req.allowedToolsets.includes("admin-toolset"),
              }),
            }),

            // Admin-only endpoint
            definePermissionAwareEndpoint({
              method: "POST",
              path: "/api/admin/action",
              bodySchema: z.object({
                action: z.string(),
              }),
              responseSchema: z.object({
                success: z.boolean(),
                message: z.string(),
              }),
              handler: async (req) => {
                if (!req.allowedToolsets.includes("admin-toolset")) {
                  throw new Error(
                    "Insufficient permissions: admin-toolset required"
                  );
                }

                return {
                  success: true,
                  message: `Action '${req.body.action}' executed successfully`,
                };
              },
            }),

            // Endpoint that checks any toolset access
            definePermissionAwareEndpoint({
              method: "GET",
              path: "/api/tools/count",
              responseSchema: z.object({
                count: z.number(),
                hasAccess: z.boolean(),
              }),
              handler: async (req) => ({
                count: req.allowedToolsets.length,
                hasAccess: req.allowedToolsets.length > 0,
              }),
            }),
          ],
        },
      });

      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("provides permission context for admin client", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/api/permissions",
        headers: {
          "mcp-client-id": "admin-client",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.clientId).toBe("admin-client");
      expect(body.allowedToolsets).toEqual(
        expect.arrayContaining(["admin-toolset", "user-toolset"])
      );
      expect(body.isAdmin).toBe(true);
    });

    it("provides permission context for user client", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/api/permissions",
        headers: {
          "mcp-client-id": "user-client",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.clientId).toBe("user-client");
      expect(body.allowedToolsets).toEqual(["user-toolset"]);
      expect(body.isAdmin).toBe(false);
    });

    it("provides empty permissions for guest client", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/api/permissions",
        headers: {
          "mcp-client-id": "guest-client",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.clientId).toBe("guest-client");
      expect(body.allowedToolsets).toEqual([]);
      expect(body.isAdmin).toBe(false);
    });

    it("allows admin action for admin client", async () => {
      const response = await testApp.inject({
        method: "POST",
        url: "/api/admin/action",
        headers: {
          "mcp-client-id": "admin-client",
        },
        payload: {
          action: "delete-user",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain("delete-user");
    });

    it("blocks admin action for user client", async () => {
      const response = await testApp.inject({
        method: "POST",
        url: "/api/admin/action",
        headers: {
          "mcp-client-id": "user-client",
        },
        payload: {
          action: "delete-user",
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toContain("Insufficient permissions");
    });

    it("counts toolsets correctly for different clients", async () => {
      // Admin client
      const adminResponse = await testApp.inject({
        method: "GET",
        url: "/api/tools/count",
        headers: {
          "mcp-client-id": "admin-client",
        },
      });

      expect(adminResponse.statusCode).toBe(200);
      let body = JSON.parse(adminResponse.body);
      expect(body.count).toBe(2);
      expect(body.hasAccess).toBe(true);

      // User client
      const userResponse = await testApp.inject({
        method: "GET",
        url: "/api/tools/count",
        headers: {
          "mcp-client-id": "user-client",
        },
      });

      expect(userResponse.statusCode).toBe(200);
      body = JSON.parse(userResponse.body);
      expect(body.count).toBe(1);
      expect(body.hasAccess).toBe(true);

      // Guest client
      const guestResponse = await testApp.inject({
        method: "GET",
        url: "/api/tools/count",
        headers: {
          "mcp-client-id": "guest-client",
        },
      });

      expect(guestResponse.statusCode).toBe(200);
      body = JSON.parse(guestResponse.body);
      expect(body.count).toBe(0);
      expect(body.hasAccess).toBe(false);
    });

    it("built-in MCP endpoints still work with permissions", async () => {
      const response = await testApp.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });
  });
});
