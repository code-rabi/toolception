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
      static builder() {
        let _defaultManager: any;
        let _createBundle: any;
        const opts: any = {};
        let _configSchema: any;
        let _sessionContextResolver: any;
        let _baseContext: any;
        const b = {
          defaultManager(v: any) { _defaultManager = v; return b; },
          createBundle(v: any) { _createBundle = v; return b; },
          host(v: any) { opts.host = v; return b; },
          port(v: any) { opts.port = v; return b; },
          basePath(v: any) { opts.basePath = v; return b; },
          cors(v: any) { opts.cors = v; return b; },
          logger(v: any) { opts.logger = v; return b; },
          app(v: any) { opts.app = v; return b; },
          customEndpoints(v: any) { opts.customEndpoints = v; return b; },
          configSchema(v: any) { _configSchema = v; return b; },
          sessionContextResolver(v: any) { _sessionContextResolver = v; return b; },
          baseContext(v: any) { _baseContext = v; return b; },
          build() { return new FastifyTransportMock(_defaultManager, _createBundle, opts, _configSchema, _sessionContextResolver, _baseContext); },
        };
        return b;
      }
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

    const s = makeFakeServerFactory();
    await createMcpServer({
      catalog,
      startup: { mode: "STATIC" },
      createServer: s.createServer,
    });
    const baseStat = s.created[0];
    expect(baseStat.calls.length).toBe(0);
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

  it("reuses a single instance in STATIC mode bundles", async () => {
    const f = makeFakeServerFactory();
    await createMcpServer({
      catalog,
      startup: { mode: "STATIC" },
      createServer: f.createServer,
    });
    const bundleFactory = (FastifyTransportMock as any).lastArgs?.[1];
    const b1 = bundleFactory();
    const b2 = bundleFactory();
    expect(b1.server).toBe(b2.server);
  });

  it("creates a fresh instance per bundle in DYNAMIC mode", async () => {
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
    const b1 = bundleFactory();
    const b2 = bundleFactory();
    expect(factory.created.length).toBe(3);
    const s1 = factory.created[1];
    const s2 = factory.created[2];
    expect(b1.server).toBe(s1.server);
    expect(b2.server).toBe(s2.server);
    expect(b1.server).not.toBe(b2.server);
    expect(s1.calls.includes("list_tools")).toBe(true);
    expect(s2.calls.includes("list_tools")).toBe(true);
  });

  it("does not re-register tools in STATIC mode across multiple clients", async () => {
    const f = makeFakeServerFactory();
    const staticCatalog = {
      core: {
        name: "Core",
        description: "",
        tools: [
          {
            name: "ping",
            description: "",
            inputSchema: {},
            handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
          },
        ],
      },
    } as any;

    await createMcpServer({
      catalog: staticCatalog,
      startup: { mode: "STATIC", toolsets: ["core"] },
      createServer: f.createServer,
    });

    const base = f.created[0];
    // One registration at startup, namespaced by toolset key
    expect(base.calls.filter((n) => n === "core.ping").length).toBe(1);

    const bundleFactory = (FastifyTransportMock as any).lastArgs?.[1];
    // Simulate two more clients (bundles)
    bundleFactory();
    bundleFactory();

    // No additional registrations should have occurred on the shared server
    expect(base.calls.filter((n) => n === "core.ping").length).toBe(1);
  });

  it("ensures tools are ready immediately in STATIC mode (waits for async module loaders)", async () => {
    const f = makeFakeServerFactory();
    let moduleLoaderStarted = false;
    let moduleLoaderCompleted = false;

    const staticCatalog = {
      testset: {
        name: "Test Toolset",
        description: "Test tools with async loading",
        modules: ["testset"],
      },
    } as any;

    await createMcpServer({
      catalog: staticCatalog,
      moduleLoaders: {
        testset: async () => {
          moduleLoaderStarted = true;
          // Simulate async loading delay
          await new Promise((r) => setTimeout(r, 100));
          moduleLoaderCompleted = true;
          return [
            {
              name: "test_tool",
              description: "A test tool",
              inputSchema: { type: "object", properties: {} },
              handler: async () => ({
                content: [{ type: "text", text: "test" }],
              }),
            },
          ];
        },
      },
      startup: { mode: "STATIC", toolsets: ["testset"] },
      createServer: f.createServer,
    });

    // After createMcpServer returns, the module loader should have completed
    expect(moduleLoaderStarted).toBe(true);
    expect(moduleLoaderCompleted).toBe(true);

    // Tools should be registered on the server
    const base = f.created[0];
    expect(base.calls.filter((n) => n === "testset.test_tool").length).toBe(1);
  });

  it("rejects invalid startup properties with Zod validation", async () => {
    const { createServer } = makeFakeServerFactory();

    // Type cast to bypass TypeScript checking (simulates user with loose types)
    const invalidOptions = {
      catalog: { core: { name: "Core", description: "", tools: [] } },
      startup: { mode: "STATIC", initialToolsets: ["core"] }, // Wrong property!
      createServer,
    } as any;

    await expect(createMcpServer(invalidOptions)).rejects.toThrow(
      /Invalid startup configuration/
    );
  });

  it("successfully parses valid startup config with 'mode' and 'toolsets' properties", async () => {
    const f = makeFakeServerFactory();
    const staticCatalog = {
      core: {
        name: "Core",
        description: "",
        tools: [
          {
            name: "ping",
            description: "",
            inputSchema: {},
            handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
          },
        ],
      },
    } as any;

    await expect(
      createMcpServer({
        catalog: staticCatalog,
        startup: { mode: "STATIC", toolsets: ["core"] },
        createServer: f.createServer,
      })
    ).resolves.toBeTruthy();

    const base = f.created[0];
    expect(base.calls.filter((n) => n === "core.ping").length).toBe(1);
  });

  it("throws a Zod validation error for completely malformed startup config object", async () => {
    const { createServer } = makeFakeServerFactory();

    // Non-object startup value
    const bad1 = {
      catalog,
      startup: 42 as any,
      createServer,
    } as any;

    // Object with wrong types for both fields
    const bad2 = {
      catalog,
      startup: { mode: 123, toolsets: 555 } as any,
      createServer,
    } as any;

    await expect(createMcpServer(bad1)).rejects.toThrow(/Invalid startup configuration/);
    await expect(createMcpServer(bad2)).rejects.toThrow(/Invalid startup configuration/);
  });

  it("accepts missing startup config without error (defaults to DYNAMIC)", async () => {
    const f = makeFakeServerFactory();
    await expect(
      createMcpServer({
        catalog,
        createServer: f.createServer,
      })
    ).resolves.toBeTruthy();

    // Default behavior in DYNAMIC mode is to register meta-tools
    const base = f.created[0];
    expect(base.calls.includes("list_tools")).toBe(true);
  });
});
