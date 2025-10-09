import { describe, it, expect, vi } from "vitest";
import { PermissionResolver } from "../src/permissions/PermissionResolver.js";
import type { PermissionConfig } from "../src/types/index.js";

describe("PermissionResolver", () => {
  describe("header-based permission parsing", () => {
    it("parses valid comma-separated toolsets from headers", () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1", {
        "mcp-toolset-permissions": "toolset-a,toolset-b,toolset-c",
      });
      expect(permissions).toEqual(["toolset-a", "toolset-b", "toolset-c"]);
    });

    it("trims whitespace from toolset names", () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1", {
        "mcp-toolset-permissions": " toolset-a , toolset-b , toolset-c ",
      });
      expect(permissions).toEqual(["toolset-a", "toolset-b", "toolset-c"]);
    });

    it("filters out empty strings from header", () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1", {
        "mcp-toolset-permissions": "toolset-a,,toolset-b,",
      });
      expect(permissions).toEqual(["toolset-a", "toolset-b"]);
    });

    it("returns empty array when header is missing", () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1", {});
      expect(permissions).toEqual([]);
    });

    it("returns empty array when headers object is undefined", () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1");
      expect(permissions).toEqual([]);
    });

    it("uses custom headerName when configured", () => {
      const config: PermissionConfig = {
        source: "headers",
        headerName: "x-custom-permissions",
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1", {
        "x-custom-permissions": "toolset-a,toolset-b",
      });
      expect(permissions).toEqual(["toolset-a", "toolset-b"]);
    });

    it("handles malformed header gracefully", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      
      // Force an error by making split throw
      const badHeaders = {
        get "mcp-toolset-permissions"() {
          throw new Error("Header parsing error");
        },
      };
      
      const permissions = resolver.resolvePermissions("client-1", badHeaders as any);
      expect(permissions).toEqual([]);
      // The error is caught at the top level and logged as an error
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected error resolving permissions"),
        expect.any(Error)
      );
      error.mockRestore();
    });
  });

  describe("config-based resolution with staticMap", () => {
    it("resolves permissions from staticMap", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a", "toolset-b"],
          "client-2": ["toolset-c"],
        },
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("client-1")).toEqual([
        "toolset-a",
        "toolset-b",
      ]);
      expect(resolver.resolvePermissions("client-2")).toEqual(["toolset-c"]);
    });

    it("returns empty array for client not in staticMap", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a"],
        },
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("unknown-client")).toEqual([]);
    });

    it("returns defaultPermissions for unknown client when configured", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a"],
        },
        defaultPermissions: ["public"],
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("unknown-client")).toEqual(["public"]);
    });

    it("handles empty array in staticMap", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "restricted-client": [],
        },
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("restricted-client")).toEqual([]);
    });
  });

  describe("config-based resolution with resolver function", () => {
    it("calls resolver function with clientId", () => {
      const resolverFn = vi.fn((clientId: string) => {
        if (clientId === "admin") return ["admin-tools"];
        return ["user-tools"];
      });
      const config: PermissionConfig = {
        source: "config",
        resolver: resolverFn,
      };
      const resolver = new PermissionResolver(config);
      
      resolver.resolvePermissions("admin");
      expect(resolverFn).toHaveBeenCalledWith("admin");
      
      resolver.resolvePermissions("user");
      expect(resolverFn).toHaveBeenCalledWith("user");
    });

    it("uses resolver result when it returns array", () => {
      const config: PermissionConfig = {
        source: "config",
        resolver: (clientId: string) => {
          if (clientId.startsWith("admin-")) return ["admin", "user"];
          return ["user"];
        },
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("admin-123")).toEqual(["admin", "user"]);
      expect(resolver.resolvePermissions("user-456")).toEqual(["user"]);
    });

    it("handles resolver returning non-array gracefully", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "config",
        resolver: () => "not-an-array" as any,
        defaultPermissions: ["fallback"],
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1");
      
      expect(permissions).toEqual(["fallback"]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("resolver returned non-array")
      );
      warn.mockRestore();
    });

    it("handles resolver throwing error gracefully", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "config",
        resolver: () => {
          throw new Error("Resolver failed");
        },
        defaultPermissions: ["fallback"],
      };
      const resolver = new PermissionResolver(config);
      const permissions = resolver.resolvePermissions("client-1");
      
      expect(permissions).toEqual(["fallback"]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("resolver declined")
      );
      warn.mockRestore();
    });
  });

  describe("resolver fallback to staticMap and defaults", () => {
    it("falls back to staticMap when resolver returns non-array", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "config",
        resolver: () => "invalid" as any,
        staticMap: {
          "client-1": ["from-static-map"],
        },
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("client-1")).toEqual(["from-static-map"]);
      warn.mockRestore();
    });

    it("falls back to staticMap when resolver throws", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "config",
        resolver: () => {
          throw new Error("Resolver error");
        },
        staticMap: {
          "client-1": ["from-static-map"],
        },
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("client-1")).toEqual(["from-static-map"]);
      warn.mockRestore();
    });

    it("falls back to defaults when resolver fails and client not in staticMap", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "config",
        resolver: () => {
          throw new Error("Resolver error");
        },
        staticMap: {
          "other-client": ["other"],
        },
        defaultPermissions: ["default-toolset"],
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("unknown-client")).toEqual([
        "default-toolset",
      ]);
      warn.mockRestore();
    });

    it("prioritizes resolver over staticMap when resolver succeeds", () => {
      const config: PermissionConfig = {
        source: "config",
        resolver: () => ["from-resolver"],
        staticMap: {
          "client-1": ["from-static-map"],
        },
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("client-1")).toEqual(["from-resolver"]);
    });
  });

  describe("caching behavior", () => {
    it("caches permissions after first resolution", () => {
      const resolverFn = vi.fn(() => ["toolset-a"]);
      const config: PermissionConfig = {
        source: "config",
        resolver: resolverFn,
      };
      const resolver = new PermissionResolver(config);
      
      // First call
      resolver.resolvePermissions("client-1");
      expect(resolverFn).toHaveBeenCalledTimes(1);
      
      // Second call should use cache
      resolver.resolvePermissions("client-1");
      expect(resolverFn).toHaveBeenCalledTimes(1);
      
      // Third call should still use cache
      resolver.resolvePermissions("client-1");
      expect(resolverFn).toHaveBeenCalledTimes(1);
    });

    it("caches different permissions for different clients", () => {
      const resolverFn = vi.fn((clientId: string) => {
        if (clientId === "admin") return ["admin-tools"];
        return ["user-tools"];
      });
      const config: PermissionConfig = {
        source: "config",
        resolver: resolverFn,
      };
      const resolver = new PermissionResolver(config);
      
      expect(resolver.resolvePermissions("admin")).toEqual(["admin-tools"]);
      expect(resolver.resolvePermissions("user")).toEqual(["user-tools"]);
      expect(resolver.resolvePermissions("admin")).toEqual(["admin-tools"]);
      
      // Should be called once per unique client
      expect(resolverFn).toHaveBeenCalledTimes(2);
    });

    it("clearCache removes cached permissions", () => {
      const resolverFn = vi.fn(() => ["toolset-a"]);
      const config: PermissionConfig = {
        source: "config",
        resolver: resolverFn,
      };
      const resolver = new PermissionResolver(config);
      
      resolver.resolvePermissions("client-1");
      expect(resolverFn).toHaveBeenCalledTimes(1);
      
      resolver.clearCache();
      
      resolver.resolvePermissions("client-1");
      expect(resolverFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling and graceful degradation", () => {
    it("filters out non-string values from permissions", () => {
      const config: PermissionConfig = {
        source: "config",
        resolver: () => ["valid", 123, null, "another-valid"] as any,
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("client-1")).toEqual([
        "valid",
        "another-valid",
      ]);
    });

    it("filters out empty string toolset names", () => {
      const config: PermissionConfig = {
        source: "config",
        resolver: () => ["valid", "", "  ", "another-valid"],
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("client-1")).toEqual([
        "valid",
        "another-valid",
      ]);
    });

    it("handles unexpected errors during resolution", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "config",
        get resolver() {
          throw new Error("Unexpected error accessing resolver");
        },
      } as any;
      const resolver = new PermissionResolver(config);
      
      const permissions = resolver.resolvePermissions("client-1");
      expect(permissions).toEqual([]);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected error resolving permissions"),
        expect.any(Error)
      );
      error.mockRestore();
    });

    it("returns empty array when resolver returns non-array and no fallback", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config: PermissionConfig = {
        source: "config",
        resolver: () => null as any,
      };
      const resolver = new PermissionResolver(config);
      expect(resolver.resolvePermissions("client-1")).toEqual([]);
      warn.mockRestore();
    });
  });
});
