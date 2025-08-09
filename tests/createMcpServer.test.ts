import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock SDK McpServer to capture constructor args
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  return {
    McpServer: class McpServerMock {
      public static lastArgs: any;
      public server: any = {};
      constructor(args: any) {
        (McpServerMock as any).lastArgs = args;
      }
      tool() {}
      async connect() {}
    },
  };
});

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

import { McpServer as McpServerMock } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FastifyTransport as FastifyTransportMock } from "../src/http/FastifyTransport.js";
import { createMcpServer } from "../src/server/createMcpServer.js";

const catalog = {
  core: { name: "Core", description: "", tools: [] },
} as any;

describe("createMcpServer", () => {
  beforeEach(() => {
    (McpServerMock as any).lastArgs = undefined;
    (FastifyTransportMock as any).lastArgs = undefined;
  });

  it("sets listChanged true in dynamic mode, false in static mode", async () => {
    await createMcpServer({ catalog, startup: { mode: "DYNAMIC" } });
    const dyn = (McpServerMock as any).lastArgs;
    expect(dyn.capabilities.tools.listChanged).toBe(true);

    await createMcpServer({ catalog, startup: { mode: "STATIC" } });
    const stat = (McpServerMock as any).lastArgs;
    expect(stat.capabilities.tools.listChanged).toBe(false);
  });

  it("passes configSchema to FastifyTransport constructor", async () => {
    const configSchema = {
      type: "object",
      properties: { FOO: { type: "string" } },
    };
    await createMcpServer({
      catalog,
      startup: { mode: "DYNAMIC" },
      configSchema,
    });
    const args = (FastifyTransportMock as any).lastArgs;
    // args: [manager, createBundle, httpOptions, configSchema]
    expect(args?.[3]).toEqual(configSchema);
  });
});
