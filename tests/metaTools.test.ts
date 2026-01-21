import { describe, it, expect } from "vitest";
import { registerMetaTools } from "../src/meta/registerMetaTools.js";
import { DynamicToolManager } from "../src/core/DynamicToolManager.js";
import { ModuleResolver } from "../src/mode/ModuleResolver.js";
import { ToolRegistry } from "../src/core/ToolRegistry.js";
import { createFakeMcpServer, type RegisteredTool } from "./helpers/fakes.js";

describe("Meta-tools return formats", () => {
  const catalog = {
    core: {
      name: "Core",
      description: "Core utilities",
      tools: [
        {
          name: "ping",
          description: "Returns pong",
          inputSchema: { type: "object", properties: {} },
          handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
        },
      ],
    },
    ext: {
      name: "Extensions",
      description: "Extra tools",
      modules: ["ext"],
      decisionCriteria: "Use when you need extended functionality",
    },
  } as any;

  const moduleLoaders = {
    ext: async () => [
      {
        name: "echo",
        description: "Echoes text",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        handler: async ({ text }: { text: string }) => ({
          content: [{ type: "text", text }],
        }),
      },
    ],
  };

  function createTestSetup() {
    const { server, tools } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog, moduleLoaders });
    const toolRegistry = new ToolRegistry({ namespaceWithToolset: true });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry,
    });
    registerMetaTools(server, manager, { mode: "DYNAMIC" });
    return { server, tools, manager };
  }

  function findTool(tools: RegisteredTool[], name: string): RegisteredTool | undefined {
    return tools.find((t) => t.name === name);
  }

  async function callTool(tools: RegisteredTool[], name: string, args: any = {}): Promise<any> {
    const tool = findTool(tools, name);
    if (!tool) throw new Error(`Tool '${name}' not found`);
    const result = await tool.handler(args);
    const text = result?.content?.[0]?.text;
    return text ? JSON.parse(text) : result;
  }

  describe("list_tools", () => {
    it("returns { tools: [], toolsetToTools: {} } when no toolsets enabled", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "list_tools");

      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("toolsetToTools");
      expect(Array.isArray(result.tools)).toBe(true);
      expect(typeof result.toolsetToTools).toBe("object");
      // No toolsets enabled, so no user tools (only meta-tools not tracked)
      expect(result.tools).toEqual([]);
      expect(result.toolsetToTools).toEqual({});
    });

    it("returns correct structure after enabling toolsets", async () => {
      const { tools, manager } = createTestSetup();

      await manager.enableToolset("core");

      const result = await callTool(tools, "list_tools");

      expect(result.tools).toContain("core.ping");
      expect(result.toolsetToTools).toHaveProperty("core");
      expect(result.toolsetToTools.core).toContain("core.ping");
    });
  });

  describe("list_toolsets", () => {
    it("returns { toolsets: [...] } with all available toolsets", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "list_toolsets");

      expect(result).toHaveProperty("toolsets");
      expect(Array.isArray(result.toolsets)).toBe(true);
      expect(result.toolsets.length).toBe(2); // core and ext

      const coreToolset = result.toolsets.find((ts: any) => ts.key === "core");
      expect(coreToolset).toBeDefined();
      expect(coreToolset.active).toBe(false);
      expect(coreToolset.definition).toHaveProperty("name", "Core");
      expect(coreToolset.definition).toHaveProperty("description", "Core utilities");

      const extToolset = result.toolsets.find((ts: any) => ts.key === "ext");
      expect(extToolset).toBeDefined();
      expect(extToolset.active).toBe(false);
      expect(extToolset.definition).toHaveProperty("name", "Extensions");
      expect(extToolset.definition.modules).toContain("ext");
      expect(extToolset.definition.decisionCriteria).toBe("Use when you need extended functionality");
    });

    it("reflects active status after enabling", async () => {
      const { tools, manager } = createTestSetup();

      await manager.enableToolset("core");

      const result = await callTool(tools, "list_toolsets");
      const coreToolset = result.toolsets.find((ts: any) => ts.key === "core");
      const extToolset = result.toolsets.find((ts: any) => ts.key === "ext");

      expect(coreToolset.active).toBe(true);
      expect(coreToolset.tools).toContain("core.ping");
      expect(extToolset.active).toBe(false);
    });
  });

  describe("describe_toolset", () => {
    it("returns { key, active, definition, tools } for valid toolset", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "describe_toolset", { name: "core" });

      expect(result).toHaveProperty("key", "core");
      expect(result).toHaveProperty("active", false);
      expect(result).toHaveProperty("definition");
      expect(result.definition.name).toBe("Core");
      expect(result.definition.description).toBe("Core utilities");
      expect(result).toHaveProperty("tools");
      expect(Array.isArray(result.tools)).toBe(true);
    });

    it("returns { error: string } for unknown toolset", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "describe_toolset", { name: "nonexistent" });

      expect(result).toHaveProperty("error");
      expect(result.error).toContain("Unknown toolset");
      expect(result.error).toContain("nonexistent");
    });

    it("includes tools after toolset is enabled", async () => {
      const { tools, manager } = createTestSetup();

      await manager.enableToolset("core");

      const result = await callTool(tools, "describe_toolset", { name: "core" });
      expect(result.active).toBe(true);
      expect(result.tools).toContain("core.ping");
    });
  });

  describe("enable_toolset", () => {
    it("returns { success: true, message: string } on success", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "enable_toolset", { name: "core" });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message");
      expect(typeof result.message).toBe("string");
      expect(result.message).toContain("enabled successfully");
    });

    it("returns { success: false, message: string } for unknown toolset", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "enable_toolset", { name: "unknown" });

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("message");
      expect(typeof result.message).toBe("string");
    });

    it("returns { success: false, message: string } when already enabled", async () => {
      const { tools } = createTestSetup();

      // Enable first time
      await callTool(tools, "enable_toolset", { name: "core" });

      // Try to enable again
      const result = await callTool(tools, "enable_toolset", { name: "core" });

      expect(result.success).toBe(false);
      expect(result.message).toContain("already enabled");
    });
  });

  describe("disable_toolset", () => {
    it("returns { success: true, message: string } on success", async () => {
      const { tools } = createTestSetup();

      // Enable first
      await callTool(tools, "enable_toolset", { name: "core" });

      // Then disable
      const result = await callTool(tools, "disable_toolset", { name: "core" });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("message");
      expect(typeof result.message).toBe("string");
      expect(result.message).toContain("disabled successfully");
    });

    it("returns { success: false, message: string } when not active", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "disable_toolset", { name: "core" });

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("message");
      expect(result.message).toContain("not currently active");
    });

    it("returns { success: false, message: string } for unknown toolset", async () => {
      const { tools } = createTestSetup();
      const result = await callTool(tools, "disable_toolset", { name: "unknown" });

      expect(result.success).toBe(false);
      expect(typeof result.message).toBe("string");
    });
  });

  describe("STATIC mode meta-tools", () => {
    it("only registers list_tools in STATIC mode", () => {
      const { server, tools } = createFakeMcpServer();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      registerMetaTools(server, manager, { mode: "STATIC" });

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("list_tools");
      expect(toolNames).not.toContain("enable_toolset");
      expect(toolNames).not.toContain("disable_toolset");
      expect(toolNames).not.toContain("list_toolsets");
      expect(toolNames).not.toContain("describe_toolset");
    });
  });
});
