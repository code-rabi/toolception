import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPermissionBasedMcpServer } from "../../src/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getAvailablePort,
  testCatalog,
  extractToolNames,
  extractTextContent,
} from "./helpers.js";

describe("Permission-based E2E", () => {
  describe("header-based permissions", () => {
    let server: Awaited<ReturnType<typeof createPermissionBasedMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createPermissionBasedMcpServer({
        createServer: () =>
          new McpServer({ name: "test-header", version: "1.0.0" }),
        catalog: testCatalog,
        permissions: { source: "headers" },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("grants toolsets based on mcp-toolset-permissions header", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        {
          requestInit: {
            headers: {
              "mcp-client-id": "header-client-1",
              "mcp-toolset-permissions": "core,admin",
            },
          },
        }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      expect(toolNames).toContain("core.ping");
      expect(toolNames).toContain("admin.reset");

      await client.close();
    });

    it("grants only requested toolsets", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        {
          requestInit: {
            headers: {
              "mcp-client-id": "header-client-2",
              "mcp-toolset-permissions": "core",
            },
          },
        }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      expect(toolNames).toContain("core.ping");
      expect(toolNames).not.toContain("admin.reset");

      await client.close();
    });

    it("calls tools from permitted toolsets", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        {
          requestInit: {
            headers: {
              "mcp-client-id": "header-client-3",
              "mcp-toolset-permissions": "core",
            },
          },
        }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const result = await client.callTool({
        name: "core.ping",
        arguments: {},
      } as any);

      expect(extractTextContent(result)).toBe("pong");

      await client.close();
    });

    it("handles whitespace in permission header", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        {
          requestInit: {
            headers: {
              "mcp-client-id": "header-client-4",
              "mcp-toolset-permissions": "  core , admin  ",
            },
          },
        }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      expect(toolNames).toContain("core.ping");
      expect(toolNames).toContain("admin.reset");

      await client.close();
    });

    it("does not expose meta-tools for changing permissions", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        {
          requestInit: {
            headers: {
              "mcp-client-id": "header-client-5",
              "mcp-toolset-permissions": "core",
            },
          },
        }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      // Should NOT have enable/disable meta-tools
      expect(toolNames).not.toContain("enable_toolset");
      expect(toolNames).not.toContain("disable_toolset");

      await client.close();
    });
  });

  describe("config-based with staticMap", () => {
    let server: Awaited<ReturnType<typeof createPermissionBasedMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createPermissionBasedMcpServer({
        createServer: () =>
          new McpServer({ name: "test-static-map", version: "1.0.0" }),
        catalog: testCatalog,
        permissions: {
          source: "config",
          staticMap: {
            "admin-client": ["core", "admin"],
            "user-client": ["core"],
          },
          defaultPermissions: [],
        },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("grants full permissions to admin client", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "admin-client" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      expect(toolNames).toContain("core.ping");
      expect(toolNames).toContain("admin.reset");

      await client.close();
    });

    it("grants limited permissions to user client", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "user-client" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      expect(toolNames).toContain("core.ping");
      expect(toolNames).not.toContain("admin.reset");

      await client.close();
    });

    it("grants default (empty) permissions to unknown client", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "unknown-client" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      // When client has no permissions, they may have no tools at all
      // which can cause listTools to fail with "Method not found"
      try {
        const tools = await client.listTools();
        const toolNames = extractToolNames(tools);
        // If we get here, verify no user tools
        expect(toolNames).not.toContain("core.ping");
        expect(toolNames).not.toContain("admin.reset");
      } catch (error: any) {
        // "Method not found" is expected when client has zero tools
        expect(error.message).toContain("Method not found");
      }

      await client.close();
    });

    it("calls tools successfully for authorized clients", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "admin-client" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const pingResult = await client.callTool({
        name: "core.ping",
        arguments: {},
      } as any);
      expect(extractTextContent(pingResult)).toBe("pong");

      const resetResult = await client.callTool({
        name: "admin.reset",
        arguments: {},
      } as any);
      expect(extractTextContent(resetResult)).toBe("reset done");

      await client.close();
    });
  });

  describe("config-based with resolver", () => {
    let server: Awaited<ReturnType<typeof createPermissionBasedMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createPermissionBasedMcpServer({
        createServer: () =>
          new McpServer({ name: "test-resolver", version: "1.0.0" }),
        catalog: testCatalog,
        permissions: {
          source: "config",
          resolver: (clientId: string) => {
            if (clientId.startsWith("admin-")) return ["core", "admin"];
            if (clientId.startsWith("user-")) return ["core"];
            return [];
          },
          defaultPermissions: [],
        },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("grants permissions based on admin- prefix", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "admin-123" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      expect(toolNames).toContain("core.ping");
      expect(toolNames).toContain("admin.reset");

      await client.close();
    });

    it("grants permissions based on user- prefix", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "user-456" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      expect(toolNames).toContain("core.ping");
      expect(toolNames).not.toContain("admin.reset");

      await client.close();
    });

    it("grants empty permissions for unknown prefix", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "unknown-789" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      // When client has no permissions, they may have no tools at all
      // which can cause listTools to fail with "Method not found"
      try {
        const tools = await client.listTools();
        const toolNames = extractToolNames(tools);
        expect(toolNames).not.toContain("core.ping");
        expect(toolNames).not.toContain("admin.reset");
      } catch (error: any) {
        // "Method not found" is expected when client has zero tools
        expect(error.message).toContain("Method not found");
      }

      await client.close();
    });

    it("each client ID resolves independently", async () => {
      // Admin client
      const adminTransport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "admin-abc" } } }
      );
      const adminClient = new Client({ name: "test", version: "1.0.0" });
      await adminClient.connect(adminTransport);

      // User client
      const userTransport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "user-xyz" } } }
      );
      const userClient = new Client({ name: "test", version: "1.0.0" });
      await userClient.connect(userTransport);

      const adminTools = await adminClient.listTools();
      const userTools = await userClient.listTools();

      const adminNames = extractToolNames(adminTools);
      const userNames = extractToolNames(userTools);

      // Admin has admin.reset, user does not
      expect(adminNames).toContain("admin.reset");
      expect(userNames).not.toContain("admin.reset");

      // Both have core.ping
      expect(adminNames).toContain("core.ping");
      expect(userNames).toContain("core.ping");

      await adminClient.close();
      await userClient.close();
    });
  });

  describe("config-based with both staticMap and resolver", () => {
    let server: Awaited<ReturnType<typeof createPermissionBasedMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createPermissionBasedMcpServer({
        createServer: () =>
          new McpServer({ name: "test-combined", version: "1.0.0" }),
        catalog: testCatalog,
        permissions: {
          source: "config",
          // Resolver takes precedence
          resolver: (clientId: string) => {
            if (clientId === "resolver-override") return ["admin"];
            // Return undefined/null to fall through to staticMap
            return undefined as any;
          },
          staticMap: {
            "static-client": ["core"],
          },
          defaultPermissions: ["core"],
        },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("resolver takes precedence over staticMap", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "resolver-override" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      // Resolver returned only admin
      expect(toolNames).toContain("admin.reset");
      expect(toolNames).not.toContain("core.ping");

      await client.close();
    });

    it("falls back to staticMap when resolver returns undefined", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "static-client" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      // Static map has core for this client
      expect(toolNames).toContain("core.ping");

      await client.close();
    });

    it("falls back to defaultPermissions for unknown clients", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "completely-unknown" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      // Default permissions include core
      expect(toolNames).toContain("core.ping");
      expect(toolNames).not.toContain("admin.reset");

      await client.close();
    });
  });
});
