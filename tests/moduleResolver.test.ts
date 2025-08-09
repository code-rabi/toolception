import { describe, it, expect } from "vitest";
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
});
