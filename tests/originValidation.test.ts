import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FastifyTransport } from "../src/http/FastifyTransport.js";
import { PermissionAwareFastifyTransport } from "../src/permissions/PermissionAwareFastifyTransport.js";
import { createMcpServer, createPermissionBasedMcpServer } from "../src/index.js";
import {
  normalizeAllowedOrigins,
  normalizeOrigin,
} from "../src/http/originValidation.js";
import { getAvailablePort, testCatalog } from "./e2e/helpers.js";

const manager: any = { getStatus: () => ({ ok: true }) };
const ALLOWED = "https://app.example.com";

/** Starts either transport on an injected Fastify app and returns the app. */
async function startTransport(
  kind: "standard" | "permission",
  allowedOrigins: string[] | undefined,
  cors = false
) {
  const app = Fastify({ logger: false });
  const options = { app, allowedOrigins, cors };
  const transport =
    kind === "standard"
      ? new FastifyTransport(manager, () => ({} as any), options)
      : new PermissionAwareFastifyTransport(
          manager,
          async () => ({} as any),
          options
        );
  await transport.start();
  return { app, transport };
}

describe("normalizeOrigin", () => {
  it("lowercases and drops default ports and paths", () => {
    expect(normalizeOrigin("HTTPS://App.Example.com:443/path")).toBe(
      "https://app.example.com"
    );
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("keeps non-http schemes comparable", () => {
    expect(normalizeOrigin("vscode-webview://abc123")).toBe(
      "vscode-webview://abc123"
    );
  });

  it("lower-cases the host of non-http schemes", () => {
    expect(normalizeOrigin("vscode-webview://ABC")).toBe("vscode-webview://abc");
  });

  it("rejects values that are not origins", () => {
    expect(normalizeOrigin("null")).toBeUndefined();
    expect(normalizeOrigin("not a url")).toBeUndefined();
    expect(normalizeOrigin("")).toBeUndefined();
  });
});

describe("normalizeAllowedOrigins", () => {
  it("throws on an entry that is not an origin", () => {
    expect(() => normalizeAllowedOrigins(["*"])).toThrow(/Invalid allowedOrigins/);
    expect(() => normalizeAllowedOrigins(["app.example.com"])).toThrow(
      /app\.example\.com/
    );
  });

  it.each(["standard", "permission"] as const)(
    "fails %s transport construction on an invalid entry",
    (kind) => {
      const options = { allowedOrigins: ["*"] };
      const create = () =>
        kind === "standard"
          ? new FastifyTransport(manager, () => ({} as any), options)
          : new PermissionAwareFastifyTransport(
              manager,
              async () => ({} as any),
              options
            );
      expect(create).toThrow(/Invalid allowedOrigins/);
    }
  );
});

describe.each(["standard", "permission"] as const)(
  "Origin validation on %s transport",
  (kind) => {
    const apps: Array<{ stop(): Promise<void> }> = [];
    afterEach(async () => {
      await Promise.all(apps.splice(0).map((t) => t.stop()));
    });

    async function start(allowed: string[] | undefined, cors = false) {
      const started = await startTransport(kind, allowed, cors);
      apps.push(started.transport);
      return started.app;
    }

    const mcpRoutes = [
      { method: "POST", payload: { jsonrpc: "2.0", id: 1, method: "ping" } },
      { method: "GET", payload: undefined },
      { method: "DELETE", payload: undefined },
    ] as const;

    it.each(mcpRoutes)("rejects a disallowed Origin on $method /mcp with 403", async ({ method, payload }) => {
      const app = await start([ALLOWED]);
      const res = await app.inject({
        method,
        url: "/mcp",
        headers: { origin: "https://evil.example.com", "mcp-client-id": "c1" },
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toBe("Forbidden: Origin not allowed");
    });

    it.each(mcpRoutes)("lets $method /mcp past the check for an allowed Origin", async ({ method, payload }) => {
      const app = await start([ALLOWED]);
      const res = await app.inject({
        method,
        url: "/mcp",
        headers: { origin: "HTTPS://APP.example.com" },
        payload,
      });
      // No mcp-client-id, so the handler answers 400: the guard did not block.
      expect(res.statusCode).toBe(400);
    });

    it.each([
      "https://app.example.com/anything",
      "https://user@app.example.com",
      "https://app.example.com?x=1",
      "https://app.example.com:443",
    ])("rejects the non-canonical Origin %s", async (origin) => {
      const app = await start([ALLOWED]);
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { origin, "mcp-client-id": "c1" },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });

    it("allows requests without an Origin header", async () => {
      const app = await start([ALLOWED]);
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: { jsonrpc: "2.0", id: 1, method: "ping" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("always rejects the literal Origin: null", async () => {
      const app = await start([ALLOWED]);
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { origin: "null", "mcp-client-id": "c1" },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });

    it("with an empty allowlist rejects every request that has an Origin", async () => {
      const app = await start([]);
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { origin: ALLOWED, "mcp-client-id": "c1" },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });

    it("does not check Origin when allowedOrigins is not set", async () => {
      const app = await start(undefined);
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { origin: "https://evil.example.com" },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("leaves /healthz open to any Origin", async () => {
      const app = await start([ALLOWED]);
      const res = await app.inject({
        method: "GET",
        url: "/healthz",
        headers: { origin: "https://evil.example.com" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("grants CORS only to allowed origins when cors is on", async () => {
      const app = await start([ALLOWED], true);
      const preflight = (origin: string) =>
        app.inject({
          method: "OPTIONS",
          url: "/mcp",
          headers: {
            origin,
            "access-control-request-method": "POST",
          },
        });
      const allowed = await preflight(ALLOWED);
      expect(allowed.headers["access-control-allow-origin"]).toBe(ALLOWED);
      const denied = await preflight("https://evil.example.com");
      expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    });
  }
);

describe("Origin validation through createMcpServer", () => {
  let server: Awaited<ReturnType<typeof createMcpServer>>;
  let port: number;

  afterEach(async () => {
    await server.close();
  });

  async function startServer() {
    port = await getAvailablePort();
    server = await createMcpServer({
      createServer: () => new McpServer({ name: "origin-test", version: "1.0.0" }),
      catalog: testCatalog,
      startup: { mode: "STATIC", toolsets: ["core"] },
      http: { port, allowedOrigins: [ALLOWED] },
    });
    await server.start();
  }

  function connect(origin: string | undefined) {
    const headers: Record<string, string> = { "mcp-client-id": "origin-client" };
    if (origin) headers.origin = origin;
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });
    return { client, connected: client.connect(transport) };
  }

  it("serves a client that sends an allowed Origin", async () => {
    await startServer();
    const { client, connected } = connect(ALLOWED);
    await connected;
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it("serves a client that sends no Origin", async () => {
    await startServer();
    const { client, connected } = connect(undefined);
    await connected;
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it("refuses a client that sends another Origin", async () => {
    await startServer();
    const { connected } = connect("https://evil.example.com");
    await expect(connected).rejects.toThrow();
  });
});

describe("Origin validation through createPermissionBasedMcpServer", () => {
  it("passes allowedOrigins to the transport", async () => {
    const port = await getAvailablePort();
    const server = await createPermissionBasedMcpServer({
      createServer: () => new McpServer({ name: "origin-test", version: "1.0.0" }),
      catalog: testCatalog,
      permissions: { source: "headers" },
      http: { port, allowedOrigins: [ALLOWED] },
    });
    await server.start();
    try {
      const post = (origin: string) =>
        fetch(`http://localhost:${port}/mcp`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: "{}",
        });
      expect((await post("https://evil.example.com")).status).toBe(403);
      // Allowed Origin reaches the handler, which wants an mcp-client-id.
      expect((await post(ALLOWED)).status).toBe(400);
    } finally {
      await server.close();
    }
  });
});
