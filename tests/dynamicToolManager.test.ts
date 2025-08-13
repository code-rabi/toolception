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
});
