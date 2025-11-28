import { describe, it, expect, vi } from "vitest";
import {
  createPermissionAwareBundle,
  type ClientRequestContext,
} from "../src/permissions/createPermissionAwareBundle.js";
import { PermissionResolver } from "../src/permissions/PermissionResolver.js";
import type { PermissionConfig } from "../src/types/index.js";
import { createFakeMcpServer } from "./helpers/fakes.js";

describe("createPermissionAwareBundle", () => {
  describe("bundle creation with resolved permissions", () => {
    it("creates bundle with permissions from resolver", async () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a", "toolset-b"],
        },
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [
            { name: "toolset-a", success: true, message: "enabled" },
            { name: "toolset-b", success: true, message: "enabled" },
          ],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const context: ClientRequestContext = {
        clientId: "client-1",
      };

      const bundle = await enhancedCreateBundle(context);

      expect(originalCreateBundle).toHaveBeenCalledWith(["toolset-a", "toolset-b"]);
      expect(bundle.server).toBe(server);
      expect(bundle.orchestrator).toBe(mockOrchestrator);
      expect(bundle.allowedToolsets).toEqual(["toolset-a", "toolset-b"]);
    });

    it("creates bundle with empty permissions for unknown client", async () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "known-client": ["toolset-a"],
        },
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({ success: true }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const context: ClientRequestContext = {
        clientId: "unknown-client",
      };

      const bundle = await enhancedCreateBundle(context);

      expect(originalCreateBundle).toHaveBeenCalledWith([]);
      expect(bundle.allowedToolsets).toEqual([]);
    });

    it("enables toolsets after bundle creation", async () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a", "toolset-b"],
        },
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [
            { name: "toolset-a", success: true, message: "enabled" },
            { name: "toolset-b", success: true, message: "enabled" },
          ],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const context: ClientRequestContext = {
        clientId: "client-1",
      };

      await enhancedCreateBundle(context);

      expect(mockManager.enableToolsets).toHaveBeenCalledWith([
        "toolset-a",
        "toolset-b",
      ]);
    });

    it("does not call enableToolsets when permissions are empty", async () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {},
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({ success: true }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const context: ClientRequestContext = {
        clientId: "client-1",
      };

      await enhancedCreateBundle(context);

      expect(mockManager.enableToolsets).not.toHaveBeenCalled();
    });
  });

  describe("allowedToolsets are passed correctly", () => {
    it("passes resolved toolsets to original bundle creator", async () => {
      const config: PermissionConfig = {
        source: "config",
        resolver: (clientId: string) => {
          if (clientId === "admin") return ["admin-tools", "user-tools"];
          return ["user-tools"];
        },
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockImplementation((toolsets: string[]) => 
          Promise.resolve({
            success: true,
            results: toolsets.map((name) => ({ name, success: true, message: "enabled" })),
            message: "All toolsets enabled",
          })
        ),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      // Test admin client
      await enhancedCreateBundle({ clientId: "admin" });
      expect(originalCreateBundle).toHaveBeenCalledWith([
        "admin-tools",
        "user-tools",
      ]);

      // Test regular user
      await enhancedCreateBundle({ clientId: "user-123" });
      expect(originalCreateBundle).toHaveBeenCalledWith(["user-tools"]);
    });

    it("includes allowedToolsets in returned bundle", async () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-x", "toolset-y", "toolset-z"],
        },
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [
            { name: "toolset-x", success: true, message: "enabled" },
            { name: "toolset-y", success: true, message: "enabled" },
            { name: "toolset-z", success: true, message: "enabled" },
          ],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const bundle = await enhancedCreateBundle({ clientId: "client-1" });

      expect(bundle.allowedToolsets).toEqual([
        "toolset-x",
        "toolset-y",
        "toolset-z",
      ]);
    });
  });

  describe("integration with PermissionResolver", () => {
    it("uses header-based permissions when configured", async () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [
            { name: "toolset-a", success: true, message: "enabled" },
            { name: "toolset-b", success: true, message: "enabled" },
          ],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const context: ClientRequestContext = {
        clientId: "client-1",
        headers: {
          "mcp-toolset-permissions": "toolset-a,toolset-b",
        },
      };

      const bundle = await enhancedCreateBundle(context);

      expect(bundle.allowedToolsets).toEqual(["toolset-a", "toolset-b"]);
      expect(originalCreateBundle).toHaveBeenCalledWith(["toolset-a", "toolset-b"]);
    });

    it("caches permissions across multiple bundle creations", async () => {
      const resolverFn = vi.fn((clientId: string) => ["toolset-a"]);
      const config: PermissionConfig = {
        source: "config",
        resolver: resolverFn,
      };
      const resolver = new PermissionResolver(config);
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [{ name: "toolset-a", success: true, message: "enabled" }],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      // Create multiple bundles for same client
      await enhancedCreateBundle({ clientId: "client-1" });
      await enhancedCreateBundle({ clientId: "client-1" });
      await enhancedCreateBundle({ clientId: "client-1" });

      // Resolver should only be called once due to caching
      expect(resolverFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("client context extraction and usage", () => {
    it("extracts clientId from context", async () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "specific-client-id": ["toolset-a"],
        },
      };
      const resolver = new PermissionResolver(config);
      const resolveSpy = vi.spyOn(resolver, "resolvePermissions");
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [{ name: "toolset-a", success: true, message: "enabled" }],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const context: ClientRequestContext = {
        clientId: "specific-client-id",
      };

      await enhancedCreateBundle(context);

      expect(resolveSpy).toHaveBeenCalledWith("specific-client-id", undefined);
    });

    it("passes headers to resolver when provided", async () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      const resolver = new PermissionResolver(config);
      const resolveSpy = vi.spyOn(resolver, "resolvePermissions");
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [{ name: "toolset-a", success: true, message: "enabled" }],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const headers = {
        "mcp-toolset-permissions": "toolset-a",
        "other-header": "value",
      };

      const context: ClientRequestContext = {
        clientId: "client-1",
        headers,
      };

      await enhancedCreateBundle(context);

      expect(resolveSpy).toHaveBeenCalledWith("client-1", headers);
    });

    it("handles context without headers", async () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a"],
        },
      };
      const resolver = new PermissionResolver(config);
      const resolveSpy = vi.spyOn(resolver, "resolvePermissions");
      const { server } = createFakeMcpServer();

      const mockManager = {
        enableToolsets: vi.fn().mockResolvedValue({
          success: true,
          results: [{ name: "toolset-a", success: true, message: "enabled" }],
          message: "All toolsets enabled",
        }),
      };
      const mockOrchestrator = {
        getManager: vi.fn().mockReturnValue(mockManager),
      } as any;

      const originalCreateBundle = vi.fn((allowedToolsets: string[]) => ({
        server,
        orchestrator: mockOrchestrator,
      }));

      const enhancedCreateBundle = createPermissionAwareBundle(
        originalCreateBundle,
        resolver
      );

      const context: ClientRequestContext = {
        clientId: "client-1",
      };

      await enhancedCreateBundle(context);

      expect(resolveSpy).toHaveBeenCalledWith("client-1", undefined);
    });
  });
});
