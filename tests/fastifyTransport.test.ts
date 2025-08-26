import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { FastifyTransport } from "../src/http/FastifyTransport.js";
import { DynamicToolManager } from "../src/core/DynamicToolManager.js";
import { ModuleResolver } from "../src/mode/ModuleResolver.js";
import { createFakeMcpServer } from "./helpers/fakes.js";

describe("FastifyTransport", () => {
  it("exposes health and tools endpoints", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools: [] } } as any,
    });
    const manager = new DynamicToolManager({ server, resolver });

    let appRef: any;
    const app = Fastify({ logger: false });
    const transport = new FastifyTransport(
      manager,
      () => ({ server, orchestrator: {} as any }),
      { port: 0, logger: false, app },
      { type: "object", properties: { FOO: { type: "string" } } }
    );
    // Start will register routes without binding to a port when app is provided
    await transport.start();

    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const tools = await app.inject({ method: "GET", url: "/tools" });
    expect(tools.statusCode).toBe(200);
    expect(tools.json().availableToolsets).toEqual(["core"]);

    const cfg = await app.inject({
      method: "GET",
      url: "/.well-known/mcp-config",
    });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().type).toBe("object");

    await transport.stop();
  });

  it("DELETE /mcp evicts session after close", async () => {
    // Fake server that supports connect()
    const server: any = {
      async connect(_t: any) {
        // no-op
      },
    };
    const resolver = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools: [] } } as any,
    });
    const manager = new DynamicToolManager({ server, resolver });

    const app = Fastify({ logger: false });
    // Stub createBundle with a minimal streamable transport-like object
    const sessions = new Map<string, any>();
    const bundle = { server, orchestrator: {} as any, sessions } as any;

    const transport = new FastifyTransport(
      manager,
      () => bundle,
      { port: 0, logger: false, app }
    );
    await transport.start();

    const clientId = "c1";
    // Seed bundle in cache with a non-initialize POST (will 400 but caches bundle)
    await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-client-id": clientId },
      payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
    });

    // Now create a fake session inside the cached bundle
    const createdSessionId = "s-1";
    const storedTransport: any = {
      sessionId: createdSessionId,
      async handleRequest() {},
      async close() {
        this._closed = true;
      },
    };
    sessions.set(createdSessionId, storedTransport);

    // Attempt DELETE
    const res = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: { "mcp-client-id": clientId, "mcp-session-id": createdSessionId },
    });
    expect(res.statusCode).toBe(204);
    expect(storedTransport._closed).toBe(true);
    expect(sessions.has(createdSessionId)).toBe(false);

    await transport.stop();
  });
});
