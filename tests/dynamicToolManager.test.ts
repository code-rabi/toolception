import { describe, it, expect } from "vitest";
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
