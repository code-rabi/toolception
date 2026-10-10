import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createMcpServer } from "../../src/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getAvailablePort,
  testCatalog,
  extractToolNames,
  extractTextContent,
  sessionContextCatalog,
  sessionContextModuleLoaders,
} from "./helpers.js";

describe("STATIC mode E2E", () => {
  describe("with specific toolsets", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createMcpServer({
        createServer: () =>
          new McpServer({
            name: "test-static",
            version: "1.0.0",
          }),
        catalog: testCatalog,
        startup: { mode: "STATIC", toolsets: ["core"] },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("has preloaded tools immediately available", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "static-client-1" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });

      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      // Core tools should be available immediately
      expect(toolNames).toContain("core.ping");

      // Admin was not preloaded
      expect(toolNames).not.toContain("admin.reset");

      await client.close();
    });

    it("does not have dynamic meta-tools in STATIC mode", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "static-client-2" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });

      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      // Should have preloaded tools
      expect(toolNames).toContain("core.ping");

      // Should NOT have dynamic meta-tools (registerMetaTools defaults to false in STATIC mode)
      expect(toolNames).not.toContain("enable_toolset");
      expect(toolNames).not.toContain("disable_toolset");
      expect(toolNames).not.toContain("list_toolsets");
      expect(toolNames).not.toContain("describe_toolset");

      await client.close();
    });

    it("calls preloaded tools successfully", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "static-client-3" } } }
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

    it(
      "multiple clients share the same toolset state",
      async () => {
        // Test that two separate clients see the same tools
        const transport1 = new StreamableHTTPClientTransport(
          new URL(`http://localhost:${port}/mcp`),
          { requestInit: { headers: { "mcp-client-id": "shared-client-1" } } }
        );
        const client1 = new Client({ name: "test", version: "1.0.0" });
        await client1.connect(transport1);

        const tools1 = await client1.listTools();
        const names1 = extractToolNames(tools1);
        expect(names1).toContain("core.ping");
        await client1.close();

        // Second client should see the same tools
        const transport2 = new StreamableHTTPClientTransport(
          new URL(`http://localhost:${port}/mcp`),
          { requestInit: { headers: { "mcp-client-id": "shared-client-2" } } }
        );
        const client2 = new Client({ name: "test", version: "1.0.0" });
        await client2.connect(transport2);

        const tools2 = await client2.listTools();
        const names2 = extractToolNames(tools2);
        expect(names2).toContain("core.ping");
        await client2.close();
      },
      10000
    );
  });

  describe("with concurrent clients", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createMcpServer({
        createServer: () =>
          new McpServer({
            name: "test-static-concurrent",
            version: "1.0.0",
          }),
        catalog: testCatalog,
        startup: { mode: "STATIC", toolsets: ["core"] },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("keeps the first client connected when a second client connects", async () => {
      const connect = async (clientId: string) => {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://localhost:${port}/mcp`),
          { requestInit: { headers: { "mcp-client-id": clientId } } }
        );
        const client = new Client({ name: "test", version: "1.0.0" });
        await client.connect(transport);
        return client;
      };

      const client1 = await connect("concurrent-client-1");
      const client2 = await connect("concurrent-client-2");

      // Both sessions stay usable at the same time
      const result1 = await client1.callTool({ name: "core.ping", arguments: {} } as any);
      const result2 = await client2.callTool({ name: "core.ping", arguments: {} } as any);
      expect(extractTextContent(result1)).toBe("pong");
      expect(extractTextContent(result2)).toBe("pong");

      await client1.close();
      await client2.close();
    });
  });

  describe("with session context", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createMcpServer({
        createServer: () =>
          new McpServer({
            name: "test-static-session-context",
            version: "1.0.0",
          }),
        catalog: sessionContextCatalog,
        moduleLoaders: sessionContextModuleLoaders,
        context: { baseValue: "shared" },
        sessionContext: {
          enabled: true,
          queryParam: {
            name: "config",
            encoding: "base64",
            allowedKeys: ["API_TOKEN"],
          },
          merge: "shallow",
        },
        startup: { mode: "STATIC", toolsets: "ALL" },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("passes per-client session context to preloaded tools", async () => {
      const connect = async (clientId: string, token: string) => {
        const config = Buffer.from(JSON.stringify({ API_TOKEN: token })).toString("base64");
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://localhost:${port}/mcp?config=${config}`),
          { requestInit: { headers: { "mcp-client-id": clientId } } }
        );
        const client = new Client({ name: "test", version: "1.0.0" });
        await client.connect(transport);
        return client;
      };
      const readContext = async (client: Client) => {
        const result = await client.callTool({ name: "tenant.get_context", arguments: {} } as any);
        return JSON.parse(extractTextContent(result));
      };

      const clientA = await connect("static-session-a", "token-a");
      const clientB = await connect("static-session-b", "token-b");

      expect(await readContext(clientA)).toEqual({ API_TOKEN: "token-a", USER_ID: null, baseValue: "shared" });
      expect(await readContext(clientB)).toEqual({ API_TOKEN: "token-b", USER_ID: null, baseValue: "shared" });

      await clientA.close();
      await clientB.close();
    });
  });

  describe("with ALL toolsets", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createMcpServer({
        createServer: () =>
          new McpServer({
            name: "test-static-all",
            version: "1.0.0",
          }),
        catalog: testCatalog,
        startup: { mode: "STATIC", toolsets: "ALL" },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("has all catalog toolsets preloaded", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "all-client-1" } } }
      );
      const client = new Client({ name: "test", version: "1.0.0" });

      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = extractToolNames(tools);

      // Both core and admin should be preloaded
      expect(toolNames).toContain("core.ping");
      expect(toolNames).toContain("admin.reset");

      await client.close();
    });

    it("calls all preloaded tools successfully", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { headers: { "mcp-client-id": "all-client-2" } } }
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
});
