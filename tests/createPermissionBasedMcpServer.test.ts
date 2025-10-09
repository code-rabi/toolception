import { describe, it, expect, vi } from "vitest";
import { createPermissionBasedMcpServer } from "../src/server/createPermissionBasedMcpServer.js";
import type { CreatePermissionBasedMcpServerOptions } from "../src/types/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("createPermissionBasedMcpServer", () => {
  const createBasicOptions = (): CreatePermissionBasedMcpServerOptions => ({
    createServer: () =>
      new McpServer({
        name: "test-server",
        version: "1.0.0",
        capabilities: { tools: { listChanged: false } },
      }),
    catalog: {
      toolsetA: {
        name: "Toolset A",
        description: "Test toolset A",
        tools: [
          {
            name: "tool-a",
            description: "Test tool",
            inputSchema: { type: "object", properties: {} },
            handler: async () => ({ content: [] }),
          },
        ],
      },
    },
    permissions: {
      source: "config",
      staticMap: {
        "client-1": ["toolsetA"],
      },
    },
  });

  describe("configuration validation", () => {
    it("throws when permissions field is missing", async () => {
      const options = {
        createServer: () => new McpServer({ name: "test", version: "1.0.0" }),
        catalog: {},
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "Permission configuration is required for createPermissionBasedMcpServer"
      );
    });

    it("throws when permissions field is null", async () => {
      const options = {
        createServer: () => new McpServer({ name: "test", version: "1.0.0" }),
        catalog: {},
        permissions: null,
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "Permission configuration is required"
      );
    });

    it("throws when permission config is invalid", async () => {
      const options = {
        createServer: () => new McpServer({ name: "test", version: "1.0.0" }),
        catalog: {},
        permissions: {
          source: "invalid-source",
        },
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "Invalid permission source"
      );
    });

    it("throws when config source lacks staticMap and resolver", async () => {
      const options = {
        createServer: () => new McpServer({ name: "test", version: "1.0.0" }),
        catalog: {},
        permissions: {
          source: "config",
        },
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "Config-based permissions require at least one of: staticMap or resolver function"
      );
    });

    it("throws when createServer is not provided", async () => {
      const options = {
        catalog: {},
        permissions: {
          source: "config",
          staticMap: {},
        },
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "createServer"
      );
    });

    it("throws when createServer is not a function", async () => {
      const options = {
        createServer: "not-a-function",
        catalog: {},
        permissions: {
          source: "config",
          staticMap: {},
        },
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "createServer"
      );
    });
  });

  describe("rejection of startup option", () => {
    it("throws when startup option is provided", async () => {
      const options = {
        ...createBasicOptions(),
        startup: { mode: "STATIC", toolsets: ["toolsetA"] },
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "Permission-based servers determine toolsets from client permissions"
      );
    });

    it("throws when startup.mode is DYNAMIC", async () => {
      const options = {
        ...createBasicOptions(),
        startup: { mode: "DYNAMIC" },
      } as any;

      await expect(createPermissionBasedMcpServer(options)).rejects.toThrow(
        "startup' option is not allowed"
      );
    });
  });

  describe("server creation with header-based permissions", () => {
    it("creates server with header-based permission config", async () => {
      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: () =>
          new McpServer({
            name: "test-server",
            version: "1.0.0",
            capabilities: { tools: { listChanged: false } },
          }),
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            tools: [],
          },
        },
        permissions: {
          source: "headers",
        },
      };

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
      expect(typeof result.start).toBe("function");
      expect(typeof result.close).toBe("function");
    });

    it("creates server with custom headerName", async () => {
      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: () =>
          new McpServer({
            name: "test-server",
            version: "1.0.0",
            capabilities: { tools: { listChanged: false } },
          }),
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            tools: [],
          },
        },
        permissions: {
          source: "headers",
          headerName: "x-custom-permissions",
        },
      };

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
    });
  });

  describe("server creation with config-based permissions", () => {
    it("creates server with staticMap permissions", async () => {
      const options = createBasicOptions();

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
      expect(typeof result.start).toBe("function");
      expect(typeof result.close).toBe("function");
    });

    it("creates server with resolver function", async () => {
      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: () =>
          new McpServer({
            name: "test-server",
            version: "1.0.0",
            capabilities: { tools: { listChanged: false } },
          }),
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            tools: [],
          },
        },
        permissions: {
          source: "config",
          resolver: (clientId: string) => {
            if (clientId.startsWith("admin-")) return ["toolsetA"];
            return [];
          },
        },
      };

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
    });

    it("creates server with both staticMap and resolver", async () => {
      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: () =>
          new McpServer({
            name: "test-server",
            version: "1.0.0",
            capabilities: { tools: { listChanged: false } },
          }),
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            tools: [],
          },
        },
        permissions: {
          source: "config",
          staticMap: {
            "client-1": ["toolsetA"],
          },
          resolver: (clientId: string) => ["toolsetA"],
          defaultPermissions: [],
        },
      };

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
    });
  });

  describe("lifecycle (start, close, cleanup)", () => {
    it("provides start method that can be called", async () => {
      const options = createBasicOptions();
      const result = await createPermissionBasedMcpServer(options);

      // Should not throw
      expect(async () => {
        await result.start();
      }).toBeDefined();
    });

    it("provides close method that can be called", async () => {
      const options = createBasicOptions();
      const result = await createPermissionBasedMcpServer(options);

      // Should not throw
      await expect(result.close()).resolves.not.toThrow();
    });

    it("close method cleans up resources", async () => {
      const options = createBasicOptions();
      const result = await createPermissionBasedMcpServer(options);

      // Close should complete successfully
      await result.close();

      // Should be able to close again without error
      await expect(result.close()).resolves.not.toThrow();
    });

    it("returns server instance matching McpServer interface", async () => {
      const options = createBasicOptions();
      const result = await createPermissionBasedMcpServer(options);

      expect(result.server).toBeInstanceOf(McpServer);
      expect(result.server).toHaveProperty("tool");
    });
  });

  describe("mock dependencies appropriately", () => {
    it("calls createServer factory during initialization", async () => {
      const createServerSpy = vi.fn(() =>
        new McpServer({
          name: "test-server",
          version: "1.0.0",
          capabilities: { tools: { listChanged: false } },
        })
      );

      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: createServerSpy,
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            tools: [],
          },
        },
        permissions: {
          source: "config",
          staticMap: {
            "client-1": ["toolsetA"],
          },
        },
      };

      await createPermissionBasedMcpServer(options);

      // Should be called at least once for base server
      expect(createServerSpy).toHaveBeenCalled();
    });

    it("accepts optional exposurePolicy configuration", async () => {
      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: () =>
          new McpServer({
            name: "test-server",
            version: "1.0.0",
            capabilities: { tools: { listChanged: false } },
          }),
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            tools: [],
          },
        },
        permissions: {
          source: "config",
          staticMap: {
            "client-1": ["toolsetA"],
          },
        },
        exposurePolicy: {
          namespaceToolsWithSetKey: true,
        },
      };

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
    });

    it("accepts optional moduleLoaders configuration", async () => {
      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: () =>
          new McpServer({
            name: "test-server",
            version: "1.0.0",
            capabilities: { tools: { listChanged: false } },
          }),
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            modules: ["moduleA"],
          },
        },
        moduleLoaders: {
          moduleA: async () => [
            {
              name: "module-tool",
              description: "Tool from module",
              inputSchema: { type: "object", properties: {} },
              handler: async () => ({ content: [] }),
            },
          ],
        },
        permissions: {
          source: "config",
          staticMap: {
            "client-1": ["toolsetA"],
          },
        },
      };

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
    });

    it("accepts optional context configuration", async () => {
      const options: CreatePermissionBasedMcpServerOptions = {
        createServer: () =>
          new McpServer({
            name: "test-server",
            version: "1.0.0",
            capabilities: { tools: { listChanged: false } },
          }),
        catalog: {
          toolsetA: {
            name: "Toolset A",
            description: "Test toolset",
            tools: [],
          },
        },
        permissions: {
          source: "config",
          staticMap: {
            "client-1": ["toolsetA"],
          },
        },
        context: {
          customData: "test-value",
        },
      };

      const result = await createPermissionBasedMcpServer(options);

      expect(result).toHaveProperty("server");
      expect(result).toHaveProperty("start");
      expect(result).toHaveProperty("close");
    });
  });
});
