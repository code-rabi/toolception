import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/core/ToolRegistry.js";

describe("ToolRegistry", () => {
  it("adds and lists tools", () => {
    const reg = new ToolRegistry({ namespaceWithToolset: false });
    reg.add("ping");
    reg.add("echo");
    expect(reg.list().sort()).toEqual(["echo", "ping"]);
  });

  it("namespaces tool names when enabled", () => {
    const reg = new ToolRegistry({ namespaceWithToolset: true });
    const mapped = reg.mapAndValidate("core", [
      {
        name: "ping",
        description: "",
        inputSchema: {},
        handler: async () => ({}),
      },
    ]);
    expect(mapped[0].name).toBe("core.ping");
    reg.addForToolset("core", mapped[0].name);
    expect(reg.listByToolset().core).toEqual(["core.ping"]);
  });

  it("throws on collision", () => {
    const reg = new ToolRegistry({ namespaceWithToolset: false });
    reg.add("tool");
    expect(() => reg.add("tool")).toThrow(/collision/i);
  });
});
