import { describe, it, expect, vi } from "vitest";
import { DynamicToolManager } from "../src/core/DynamicToolManager.js";
import { ModuleResolver } from "../src/mode/ModuleResolver.js";
import { ToolRegistry } from "../src/core/ToolRegistry.js";
import { createFakeMcpServer } from "./helpers/fakes.js";

describe("DynamicToolManager", () => {
  const catalog = {
    core: {
      name: "Core",
      description: "",
      tools: [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({ ok: true }),
        },
      ],
    },
    ext: { name: "Ext", description: "", modules: ["ext"] },
  } as any;

  it("enables toolset and registers tools with namespacing", async () => {
    const { server, tools } = createFakeMcpServer();
    const resolver = new ModuleResolver({
      catalog,
      moduleLoaders: {
        ext: async () => [
          {
            name: "echo",
            description: "",
            inputSchema: {},
            handler: async () => ({}),
          },
        ],
      },
    });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });
    const res = await manager.enableToolset("core");
    expect(res.success).toBe(true);
    expect(manager.isActive("core")).toBe(true);
    expect(tools.map((t) => t.name)).toEqual(["core.ping"]);
  });

  it("applies allow/deny policy and maxActiveToolsets", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({
      server,
      resolver,
      exposurePolicy: {
        allowlist: ["core"],
        denylist: ["ext"],
        maxActiveToolsets: 1,
      },
    });
    expect((await manager.enableToolset("ext")).success).toBe(false);
    expect((await manager.enableToolset("core")).success).toBe(true);
    expect((await manager.enableToolset("core")).success).toBe(false); // already active
    expect((await manager.enableToolset("ext")).success).toBe(false); // exceeds max
  });

  it("returns validation error for unknown toolset and handles resolver failure", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({ server, resolver });
    // Unknown toolset
    const bad = await manager.enableToolset("does-not-exist");
    expect(bad.success).toBe(false);
    expect(bad.message).toMatch(/not found|Invalid/);

    // Force resolver failure
    vi.spyOn(resolver, "resolveToolsForToolsets").mockRejectedValue(
      new Error("loader exploded")
    );
    const err = await manager.enableToolset("core");
    expect(err.success).toBe(false);
    expect(err.message).toMatch(/loader exploded/);
  });

  it("disableToolset validates input and warns when notify fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({
      server,
      resolver,
      // simulate notify failing
      onToolsListChanged: async () => {
        throw new Error("notify failed");
      },
    });

    // invalid disable
    const invalid = await manager.disableToolset("");
    expect(invalid.success).toBe(false);

    // not active
    const notActive = await manager.disableToolset("core");
    expect(notActive.success).toBe(false);

    // enable then disable, hitting notify warning path
    await manager.enableToolset("core");
    const res = await manager.disableToolset("core");
    expect(res.success).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "Failed to send tool list change notification:",
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it("disableToolset updates state and returns message", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({ server, resolver });
    await manager.enableToolset("core");
    const res = await manager.disableToolset("core");
    expect(res.success).toBe(true);
    expect(manager.isActive("core")).toBe(false);
  });

  it("enableAllToolsets aggregates results", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({ server, resolver });
    const res = await manager.enableAllToolsets();
    expect(res.results.length).toBe(2);
    expect(res.success).toBe(true);
  });

  it("registers tools with annotations when provided", async () => {
    const { server, tools } = createFakeMcpServer();
    const catalogWithAnnotations = {
      annotated: {
        name: "Annotated Tools",
        description: "Tools with annotations",
        tools: [
          {
            name: "read_data",
            description: "Read-only tool",
            inputSchema: {},
            handler: async () => ({ data: "test" }),
            annotations: {
              readOnlyHint: true,
              idempotentHint: true,
            },
          },
          {
            name: "delete_data",
            description: "Destructive tool",
            inputSchema: {},
            handler: async () => ({ deleted: true }),
            annotations: {
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          {
            name: "fetch_weather",
            description: "External API tool",
            inputSchema: {},
            handler: async () => ({ weather: "sunny" }),
            annotations: {
              readOnlyHint: true,
              openWorldHint: true,
              idempotentHint: false,
            },
          },
        ],
      },
    } as any;

    const resolver = new ModuleResolver({ catalog: catalogWithAnnotations });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });

    const res = await manager.enableToolset("annotated");
    expect(res.success).toBe(true);

    // Verify all tools were registered with correct annotations
    expect(tools.length).toBe(3);

    const readTool = tools.find((t) => t.name === "annotated.read_data");
    expect(readTool).toBeDefined();
    expect(readTool?.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
    });

    const deleteTool = tools.find((t) => t.name === "annotated.delete_data");
    expect(deleteTool).toBeDefined();
    expect(deleteTool?.annotations).toEqual({
      destructiveHint: true,
      idempotentHint: false,
    });

    const fetchTool = tools.find((t) => t.name === "annotated.fetch_weather");
    expect(fetchTool).toBeDefined();
    expect(fetchTool?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: false,
    });
  });

  it("registers tools without annotations when not provided", async () => {
    const { server, tools } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });

    const res = await manager.enableToolset("core");
    expect(res.success).toBe(true);

    const tool = tools.find((t) => t.name === "core.ping");
    expect(tool).toBeDefined();
    expect(tool?.annotations).toBeUndefined();
  });

  it("registers module-loaded tools with annotations", async () => {
    const { server, tools } = createFakeMcpServer();
    const catalogWithModules = {
      external: {
        name: "External",
        description: "External tools",
        modules: ["external"],
      },
    } as any;

    const resolver = new ModuleResolver({
      catalog: catalogWithModules,
      moduleLoaders: {
        external: async () => [
          {
            name: "api_call",
            description: "Call external API",
            inputSchema: {},
            handler: async () => ({ result: "ok" }),
            annotations: {
              openWorldHint: true,
              readOnlyHint: false,
              idempotentHint: false,
            },
          },
        ],
      },
    });

    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });

    const res = await manager.enableToolset("external");
    expect(res.success).toBe(true);

    const tool = tools.find((t) => t.name === "external.api_call");
    expect(tool).toBeDefined();
    expect(tool?.annotations).toEqual({
      openWorldHint: true,
      readOnlyHint: false,
      idempotentHint: false,
    });
  });
});
