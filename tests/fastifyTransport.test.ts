import { describe, it, expect, vi } from "vitest";
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

  it("POST /mcp without mcp-client-id returns 400", async () => {
    const server: any = {
      async connect(_t: any) {},
    };
    const resolver = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools: [] } } as any,
    });
    const manager = new DynamicToolManager({ server, resolver });

    const app = Fastify({ logger: false });

    const transport = new FastifyTransport(
      manager,
      () => ({ server, orchestrator: {} as any }),
      { port: 0, logger: false, app }
    );
    await transport.start();

    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {},
      payload: {
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
        id: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(-32600);
    expect(res.json().error.message).toContain("mcp-client-id");

    await transport.stop();
  });

  it("POST /mcp with whitespace-only mcp-client-id returns 400", async () => {
    const server: any = {
      async connect(_t: any) {},
    };
    const resolver = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools: [] } } as any,
    });
    const manager = new DynamicToolManager({ server, resolver });

    const app = Fastify({ logger: false });

    const transport = new FastifyTransport(
      manager,
      () => ({ server, orchestrator: {} as any }),
      { port: 0, logger: false, app }
    );
    await transport.start();

    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-client-id": "   " },
      payload: {
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
        id: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(-32600);

    await transport.stop();
  });

  it("DELETE /mcp returns proper errors for invalid requests", async () => {
    const server: any = {
      async connect(_t: any) {},
    };
    const resolver = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools: [] } } as any,
    });
    const manager = new DynamicToolManager({ server, resolver });

    const app = Fastify({ logger: false });

    const transport = new FastifyTransport(
      manager,
      () => ({ server, orchestrator: {} as any }),
      { port: 0, logger: false, app }
    );
    await transport.start();

    // Missing mcp-client-id header
    const res1 = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: { "mcp-session-id": "some-session" },
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().error.message).toContain("Missing mcp-client-id");

    // Missing mcp-session-id header
    const res2 = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: { "mcp-client-id": "some-client" },
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().error.message).toContain("Missing");

    // Non-existent client/session returns 404
    const res3 = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: { "mcp-client-id": "unknown-client", "mcp-session-id": "unknown-session" },
    });
    expect(res3.statusCode).toBe(404);
    expect(res3.json().error.message).toContain("not found");

    await transport.stop();
  });
  it("POST /mcp initialize returns a JSON-RPC error when the client's toolsets failed to load", async () => {
    const connect = vi.fn(async (_t: any) => {});
    const server: any = { connect, close: async () => {} };
    const resolver = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools: [] } } as any,
    });
    const manager = new DynamicToolManager({ server, resolver });

    const app = Fastify({ logger: false });
    const createBundle = vi.fn(() => ({
      server,
      orchestrator: { isReady: async () => false } as any,
    }));
    const transport = new FastifyTransport(manager, createBundle, {
      port: 0,
      logger: false,
      app,
    });
    await transport.start();

    const initialize = () =>
      app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          "mcp-client-id": "failing-client",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        },
      });

    const first = await initialize();
    expect(first.statusCode).toBe(500);
    expect(first.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Failed to load toolsets for this client." },
      id: null,
    });
    expect(connect).not.toHaveBeenCalled();

    // The failed bundle is dropped, so a retry builds a fresh one
    await initialize();
    expect(createBundle).toHaveBeenCalledTimes(2);

    await transport.stop();
  });
});
