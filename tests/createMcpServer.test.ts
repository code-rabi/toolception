import { describe, it, expect, vi, beforeEach } from "vitest";

// We no longer construct McpServer inside the library; provide a simple fake

// Mock FastifyTransport to capture constructor args and avoid opening sockets
vi.mock("../src/http/FastifyTransport.js", () => {
  return {
    FastifyTransport: class FastifyTransportMock {
      public static lastArgs: any[];
      constructor(...args: any[]) {
        (FastifyTransportMock as any).lastArgs = args;
      }
      async start() {}
      async stop() {}
    },
  };
});

import { FastifyTransport as FastifyTransportMock } from "../src/http/FastifyTransport.js";
import { createMcpServer } from "../src/server/createMcpServer.js";

const catalog = {
  core: { name: "Core", description: "", tools: [] },
} as any;

function makeFakeServer() {
  const calls: string[] = [];
  const server = {
    tool: (name: string) => {
      calls.push(name);
    },
  } as any;
  return { server, calls };
}

function makeFakeServerFactory() {
  const created: Array<{ server: any; calls: string[] }> = [];
  const createServer = () => {
    const s = makeFakeServer();
    created.push(s);
    return s.server;
  };
  return { createServer, created } as const;
}

describe("createMcpServer", () => {
  beforeEach(() => {
    (FastifyTransportMock as any).lastArgs = undefined;
  });

  it("registers meta-tools by default in dynamic mode, not in static mode", async () => {
    const d = makeFakeServerFactory();
    await createMcpServer({
      catalog,
      startup: { mode: "DYNAMIC" },
      createServer: d.createServer,
    });
    const baseDyn = d.created[0];
    expect(baseDyn.calls.includes("list_tools")).toBe(true);
    expect(baseDyn.calls.includes("list_toolsets")).toBe(true);

    const s = makeFakeServer();
    await createMcpServer({
      catalog,
      startup: { mode: "STATIC" },
      server: s.server,
    });
    expect(s.calls.length).toBe(0);
  });

  it("passes configSchema to FastifyTransport constructor", async () => {
    const configSchema = {
      type: "object",
      properties: { FOO: { type: "string" } },
    };
    const { createServer } = makeFakeServerFactory();
    await createMcpServer({
      catalog,
      startup: { mode: "DYNAMIC" },
      createServer,
      configSchema,
    });
    const args = (FastifyTransportMock as any).lastArgs;
    // args: [manager, createBundle, httpOptions, configSchema]
    expect(args?.[3]).toEqual(configSchema);
  });

  it("uses provided server when only server is set, and reuses it for bundles (STATIC)", async () => {
    const base = makeFakeServer();
    await createMcpServer({
      catalog,
      startup: { mode: "STATIC" },
      server: base.server,
    });
    const bundleFactory = (FastifyTransportMock as any).lastArgs?.[1];
    const bundle = bundleFactory();
    expect(bundle.server).toBe(base.server);
  });

  it("uses createServer when only factory is set (base + per-client)", async () => {
    const factory = makeFakeServerFactory();
    await createMcpServer({
      catalog,
      startup: { mode: "DYNAMIC" },
      createServer: factory.createServer,
    });
    // base server created immediately
    expect(factory.created.length).toBe(1);
    const base = factory.created[0];
    expect(base.calls.includes("list_tools")).toBe(true);

    // per-client bundle uses a fresh server
    const bundleFactory = (FastifyTransportMock as any).lastArgs?.[1];
    const bundle = bundleFactory();
    expect(factory.created.length).toBe(2);
    const perClient = factory.created[1];
    expect(bundle.server).toBe(perClient.server);
    expect(perClient.calls.includes("list_tools")).toBe(true);
  });

  it("uses provided server for base and factory for bundles when both provided", async () => {
    const base = makeFakeServer();
    const factory = makeFakeServerFactory();
    await createMcpServer({
      catalog,
      startup: { mode: "DYNAMIC" },
      server: base.server,
      createServer: factory.createServer,
    });
    // base server remains the provided one
    expect(factory.created.length).toBe(0);
    const bundleFactory = (FastifyTransportMock as any).lastArgs?.[1];
    const bundle = bundleFactory();
    expect(factory.created.length).toBe(1);
    const perClient = factory.created[0];
    expect(bundle.server).not.toBe(base.server);
    expect(bundle.server).toBe(perClient.server);
    expect(base.calls.includes("list_tools")).toBe(true);
    expect(perClient.calls.includes("list_tools")).toBe(true);
  });
});
