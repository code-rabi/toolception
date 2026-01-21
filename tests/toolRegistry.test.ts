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

  describe("namespacing edge cases", () => {
    it("does not namespace when namespaceWithToolset is false", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: false });
      const mapped = reg.mapAndValidate("core", [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      expect(mapped[0].name).toBe("ping"); // Not prefixed
    });

    it("handles tool names that already have the correct prefix", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: true });
      const mapped = reg.mapAndValidate("core", [
        {
          name: "core.ping", // Already has prefix
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      // Should not double-prefix
      expect(mapped[0].name).toBe("core.ping");
    });

    it("handles tool names with dots when namespacing is enabled", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: true });
      const mapped = reg.mapAndValidate("my-toolset", [
        {
          name: "api.v2.call", // Tool name has internal dots
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      expect(mapped[0].name).toBe("my-toolset.api.v2.call");
    });

    it("handles tool names with special characters", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: true });

      // Underscores
      const mapped1 = reg.mapAndValidate("toolset", [
        {
          name: "get_user_data",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      expect(mapped1[0].name).toBe("toolset.get_user_data");

      // Hyphens
      const mapped2 = reg.mapAndValidate("toolset", [
        {
          name: "get-user-data",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      expect(mapped2[0].name).toBe("toolset.get-user-data");
    });

    it("handles long tool names", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: true });
      const longName = "a".repeat(200);
      const mapped = reg.mapAndValidate("toolset", [
        {
          name: longName,
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      expect(mapped[0].name).toBe(`toolset.${longName}`);
    });

    it("handles empty toolset key", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: true });
      const mapped = reg.mapAndValidate("", [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      // Empty prefix should still work (results in ".ping")
      expect(mapped[0].name).toBe(".ping");
    });
  });

  describe("collision detection", () => {
    it("detects collision in mapAndValidate with namespacing", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: true });

      // First registration
      const mapped1 = reg.mapAndValidate("core", [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      reg.addForToolset("core", mapped1[0].name);

      // Second registration with same name should throw
      expect(() =>
        reg.mapAndValidate("core", [
          {
            name: "ping",
            description: "",
            inputSchema: {},
            handler: async () => ({}),
          },
        ])
      ).toThrow(/collision/i);
    });

    it("detects collision across toolsets when namespacing is disabled", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: false });

      const mapped1 = reg.mapAndValidate("toolset1", [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      reg.addForToolset("toolset1", mapped1[0].name);

      // Same tool name from different toolset should collide
      expect(() =>
        reg.mapAndValidate("toolset2", [
          {
            name: "ping",
            description: "",
            inputSchema: {},
            handler: async () => ({}),
          },
        ])
      ).toThrow(/collision/i);
    });

    it("allows same tool name from different toolsets when namespacing is enabled", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: true });

      const mapped1 = reg.mapAndValidate("toolset1", [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      reg.addForToolset("toolset1", mapped1[0].name);

      // Same tool name from different toolset should NOT collide (different prefix)
      const mapped2 = reg.mapAndValidate("toolset2", [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({}),
        },
      ]);
      expect(mapped2[0].name).toBe("toolset2.ping");
    });
  });

  describe("has() method", () => {
    it("returns true for existing tools", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: false });
      reg.add("ping");
      expect(reg.has("ping")).toBe(true);
    });

    it("returns false for non-existing tools", () => {
      const reg = new ToolRegistry({ namespaceWithToolset: false });
      expect(reg.has("nonexistent")).toBe(false);
    });
  });
});
