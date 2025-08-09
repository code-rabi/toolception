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
});
