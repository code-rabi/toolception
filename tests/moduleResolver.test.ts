import { describe, it, expect, vi } from "vitest";
import { ModuleResolver } from "../src/mode/ModuleResolver.js";

describe("ModuleResolver", () => {
  it("lists and validates toolsets", () => {
    const r = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools: [] } } as any,
    });
    expect(r.getAvailableToolsets()).toEqual(["core"]);
    expect(r.validateToolsetName("core").isValid).toBe(true);
    expect(r.validateToolsetName("missing").isValid).toBe(false);
  });

  it("resolves direct and module tools", async () => {
    const r = new ModuleResolver({
      catalog: {
        core: {
          name: "Core",
          description: "",
          tools: [
            {
              name: "ping",
              description: "",
              inputSchema: {},
              handler: async () => ({}),
            },
          ],
        },
        ext: { name: "Ext", description: "", modules: ["ext"] },
      } as any,
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
    const tools = await r.resolveToolsForToolsets(["core", "ext"], undefined);
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "ping"]);
  });

  describe("module loader error handling", () => {
    it("logs warning and continues when module loader throws", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const r = new ModuleResolver({
        catalog: {
          core: {
            name: "Core",
            description: "",
            tools: [
              {
                name: "ping",
                description: "",
                inputSchema: {},
                handler: async () => ({}),
              },
            ],
          },
          broken: { name: "Broken", description: "", modules: ["broken"] },
        } as any,
        moduleLoaders: {
          broken: async () => {
            throw new Error("Module loader exploded");
          },
        },
      });

      // Should not throw, just log warning
      const tools = await r.resolveToolsForToolsets(["core", "broken"], undefined);

      // Direct tools from core should still be resolved
      expect(tools.map((t) => t.name)).toContain("ping");
      expect(warn).toHaveBeenCalled();

      warn.mockRestore();
    });

    it("handles module loader returning empty array", async () => {
      const r = new ModuleResolver({
        catalog: {
          empty: { name: "Empty", description: "", modules: ["empty"] },
        } as any,
        moduleLoaders: {
          empty: async () => [],
        },
      });

      const tools = await r.resolveToolsForToolsets(["empty"], undefined);
      expect(tools).toEqual([]);
    });

    it("silently skips when module loader is not found", async () => {
      const r = new ModuleResolver({
        catalog: {
          orphan: { name: "Orphan", description: "", modules: ["nonexistent"] },
        } as any,
        moduleLoaders: {}, // No loader for "nonexistent"
      });

      // Should not throw, just return empty array (silently skips)
      const tools = await r.resolveToolsForToolsets(["orphan"], undefined);
      expect(tools).toEqual([]);
    });

    it("passes context to module loaders", async () => {
      const contextReceived: unknown[] = [];

      const r = new ModuleResolver({
        catalog: {
          contextual: { name: "Contextual", description: "", modules: ["ctx"] },
        } as any,
        moduleLoaders: {
          ctx: async (context) => {
            contextReceived.push(context);
            return [
              {
                name: "contextual_tool",
                description: "",
                inputSchema: {},
                handler: async () => ({}),
              },
            ];
          },
        },
      });

      const testContext = { userId: "test-123", config: { debug: true } };
      const tools = await r.resolveToolsForToolsets(["contextual"], testContext);

      expect(tools.map((t) => t.name)).toContain("contextual_tool");
      expect(contextReceived).toHaveLength(1);
      expect(contextReceived[0]).toEqual(testContext);
    });

    it("handles synchronous module loaders", async () => {
      const r = new ModuleResolver({
        catalog: {
          sync: { name: "Sync", description: "", modules: ["sync"] },
        } as any,
        moduleLoaders: {
          sync: () => [
            {
              name: "sync_tool",
              description: "",
              inputSchema: {},
              handler: async () => ({}),
            },
          ],
        },
      });

      const tools = await r.resolveToolsForToolsets(["sync"], undefined);
      expect(tools.map((t) => t.name)).toContain("sync_tool");
    });
  });
});
