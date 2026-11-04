import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createMcpServer,
  createPermissionBasedMcpServer,
} from "../../src/index.js";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import {
  getAvailablePort,
  testCatalog,
  extractToolNames,
  parseToolResponse,
  sessionContextCatalog,
  sessionContextModuleLoaders,
} from "./helpers.js";

/**
 * Acceptance gate for the MCP SDK v2 move: every client keeps its own server,
 * transport and enabled/disabled toolset state, so one client's changes never
 * show up for another client connected at the same time.
 */

interface Connected {
  readonly client: Client;
  readonly transport: StreamableHTTPClientTransport;
  /** Number of `tools/list_changed` notifications this client has received. */
  listChangedCount(): number;
}

async function connect(
  port: number,
  clientId: string,
  extraHeaders: Record<string, string> = {},
  query = ""
): Promise<Connected> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/mcp${query}`),
    {
      requestInit: {
        headers: { "mcp-client-id": clientId, ...extraHeaders },
      },
    }
  );
  const client = new Client({ name: "test", version: "1.0.0" });
  let count = 0;
  client.setNotificationHandler("notifications/tools/list_changed", () => {
    count += 1;
  });
  await client.connect(transport);
  return { client, transport, listChangedCount: () => count };
}

async function toolNames(c: Connected): Promise<string[]> {
  return extractToolNames(await c.client.listTools()).sort();
}

async function metaCall(c: Connected, tool: string, name: string) {
  return parseToolResponse<{ success: boolean }>(
    await c.client.callTool({ name: tool, arguments: { name } } as any)
  );
}

/** Polls until `condition` holds, so tests do not depend on a fixed delay. */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("multiple concurrent clients keep their own toolset state", () => {
  describe("DYNAMIC mode", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let port: number;
    let serversCreated = 0;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createMcpServer({
        createServer: () => {
          serversCreated += 1;
          return new McpServer(
            { name: "multi-dynamic", version: "1.0.0" },
            { capabilities: { tools: { listChanged: true } } }
          );
        },
        catalog: testCatalog,
        startup: { mode: "DYNAMIC" },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("never leaks enable/disable between clients", async () => {
      const a = await connect(port, "multi-a1");
      const b = await connect(port, "multi-b1");
      const metaOnly = await toolNames(b);
      expect(metaOnly).not.toContain("core.ping");

      expect((await metaCall(a, "enable_toolset", "core")).success).toBe(true);
      expect((await metaCall(a, "enable_toolset", "admin")).success).toBe(true);
      expect((await metaCall(a, "disable_toolset", "admin")).success).toBe(true);

      const aTools = await toolNames(a);
      expect(aTools).toContain("core.ping");
      expect(aTools).not.toContain("admin.reset");
      expect(await toolNames(b)).toEqual(metaOnly);

      // Now B changes its state; A must not notice.
      expect((await metaCall(b, "enable_toolset", "admin")).success).toBe(true);
      expect(await toolNames(b)).toContain("admin.reset");
      expect(await toolNames(b)).not.toContain("core.ping");
      expect(await toolNames(a)).toEqual(aTools);

      await a.client.close();
      await b.client.close();
    });

    it("removes a disabled tool for that client only", async () => {
      const a = await connect(port, "multi-a2");
      const b = await connect(port, "multi-b2");
      await metaCall(a, "enable_toolset", "core");
      await metaCall(b, "enable_toolset", "core");

      await metaCall(a, "disable_toolset", "core");

      await expect(
        a.client.callTool({ name: "core.ping", arguments: {} })
      ).rejects.toThrow(/not found/i);
      const stillWorks = await b.client.callTool({
        name: "core.ping",
        arguments: {},
      });
      expect((stillWorks.content as any)[0].text).toBe("pong");
      expect(await toolNames(b)).toContain("core.ping");

      await a.client.close();
      await b.client.close();
    });

    it("sends tools/list_changed only to the client whose state changed", async () => {
      const a = await connect(port, "multi-a3");
      const b = await connect(port, "multi-b3");
      const bBefore = b.listChangedCount();
      const aBefore = a.listChangedCount();

      await metaCall(a, "enable_toolset", "core");
      // Once A has been notified, B would have been too if the change leaked.
      await waitFor(() => a.listChangedCount() > aBefore);
      await toolNames(b);

      expect(b.listChangedCount()).toBe(bBefore);

      await a.client.close();
      await b.client.close();
    });

    it("keeps state when the same client id reconnects, and rejects other clients' sessions", async () => {
      const first = await connect(port, "multi-a4");
      await metaCall(first, "enable_toolset", "core");
      const sessionId = first.transport.sessionId;
      expect(sessionId).toBeTruthy();
      const other = await connect(port, "multi-b4");

      // A different client id must not use A's session.
      const hijack = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-client-id": "multi-b4",
          "mcp-session-id": sessionId as string,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(hijack.status).toBe(400);
      const hijackDelete = await fetch(`http://localhost:${port}/mcp`, {
        method: "DELETE",
        headers: {
          "mcp-client-id": "multi-b4",
          "mcp-session-id": sessionId as string,
        },
      });
      expect(hijackDelete.status).toBe(404);
      expect(await toolNames(other)).not.toContain("core.ping");

      // The same client id reconnects (without DELETE) and keeps its toolsets.
      await first.client.close();
      const again = await connect(port, "multi-a4");
      expect(await toolNames(again)).toContain("core.ping");

      await again.client.close();
      await other.client.close();
    });

    it("creates one McpServer per client id, not per request", async () => {
      const before = serversCreated;
      const a = await connect(port, "multi-a5");
      const b = await connect(port, "multi-b5");
      await toolNames(a);
      await toolNames(b);
      await toolNames(a);
      expect(serversCreated - before).toBe(2);
      await a.client.close();
      await b.client.close();
    });
  });

  describe("DYNAMIC mode with session context", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createMcpServer({
        createServer: () =>
          new McpServer(
            { name: "multi-context", version: "1.0.0" },
            { capabilities: { tools: { listChanged: true } } }
          ),
        catalog: sessionContextCatalog,
        moduleLoaders: sessionContextModuleLoaders,
        sessionContext: {
          enabled: true,
          queryParam: {
            name: "config",
            encoding: "base64",
            allowedKeys: ["API_TOKEN"],
          },
          merge: "shallow",
        },
        startup: { mode: "DYNAMIC" },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("never shows one client's token to another client's tools", async () => {
      const query = (token: string) =>
        `?config=${Buffer.from(JSON.stringify({ API_TOKEN: token })).toString("base64")}`;
      const a = await connect(port, "ctx-a", {}, query("token-a"));
      const b = await connect(port, "ctx-b", {}, query("token-b"));
      await metaCall(a, "enable_toolset", "tenant");
      await metaCall(b, "enable_toolset", "tenant");

      const read = async (c: Connected) =>
        parseToolResponse<{ API_TOKEN: string }>(
          await c.client.callTool({ name: "tenant.get_context", arguments: {} })
        ).API_TOKEN;

      expect(await read(a)).toBe("token-a");
      expect(await read(b)).toBe("token-b");
      expect(await read(a)).toBe("token-a");

      await a.client.close();
      await b.client.close();
    });
  });

  describe("STATIC mode", () => {
    let server: Awaited<ReturnType<typeof createMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createMcpServer({
        createServer: () =>
          new McpServer({ name: "multi-static", version: "1.0.0" }),
        catalog: testCatalog,
        startup: { mode: "STATIC", toolsets: ["core"] },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("serves several clients at once, each from its own bundle", async () => {
      const clients = await Promise.all([
        connect(port, "static-multi-1"),
        connect(port, "static-multi-2"),
        connect(port, "static-multi-3"),
      ]);
      for (const c of clients) {
        expect(await toolNames(c)).toEqual(["core.ping"]);
        const res = await c.client.callTool({ name: "core.ping", arguments: {} });
        expect((res.content as any)[0].text).toBe("pong");
      }
      // A new client connecting does not drop the earlier ones.
      const late = await connect(port, "static-multi-4");
      expect(await toolNames(clients[0])).toEqual(["core.ping"]);
      for (const c of [...clients, late]) await c.client.close();
    });
  });

  describe("permission-based mode", () => {
    let server: Awaited<ReturnType<typeof createPermissionBasedMcpServer>>;
    let port: number;

    beforeAll(async () => {
      port = await getAvailablePort();
      server = await createPermissionBasedMcpServer({
        createServer: () =>
          new McpServer({ name: "multi-permission", version: "1.0.0" }),
        catalog: testCatalog,
        permissions: {
          source: "config",
          staticMap: { "perm-admin": ["core", "admin"], "perm-user": ["core"] },
          defaultPermissions: [],
        },
        http: { port },
      });
      await server.start();
    });

    afterAll(async () => {
      await server.close();
    });

    it("keeps concurrent clients' permitted tools apart", async () => {
      const admin = await connect(port, "perm-admin");
      const user = await connect(port, "perm-user");

      expect(await toolNames(admin)).toEqual(["admin.reset", "core.ping"]);
      expect(await toolNames(user)).toEqual(["core.ping"]);

      // The user client cannot reach the admin client's tool.
      await expect(
        user.client.callTool({ name: "admin.reset", arguments: {} })
      ).rejects.toThrow(/not found/i);
      const res = await admin.client.callTool({
        name: "admin.reset",
        arguments: {},
      });
      expect((res.content as any)[0].text).toBe("reset done");

      await admin.client.close();
      await user.client.close();
    });
  });
});
