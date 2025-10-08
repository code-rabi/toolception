import { describe, it, expect } from "vitest";
import { validatePermissionConfig } from "../src/permissions/validatePermissionConfig.js";
import type { PermissionConfig } from "../src/types/index.js";

describe("validatePermissionConfig", () => {
  describe("valid configurations", () => {
    it("accepts valid header-based configuration", () => {
      const config: PermissionConfig = {
        source: "headers",
      };
      expect(() => validatePermissionConfig(config)).not.toThrow();
    });

    it("accepts header-based config with custom headerName", () => {
      const config: PermissionConfig = {
        source: "headers",
        headerName: "x-custom-permissions",
      };
      expect(() => validatePermissionConfig(config)).not.toThrow();
    });

    it("accepts config-based with staticMap only", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a", "toolset-b"],
          "client-2": ["toolset-c"],
        },
      };
      expect(() => validatePermissionConfig(config)).not.toThrow();
    });

    it("accepts config-based with resolver only", () => {
      const config: PermissionConfig = {
        source: "config",
        resolver: (clientId: string) => ["toolset-a"],
      };
      expect(() => validatePermissionConfig(config)).not.toThrow();
    });

    it("accepts config-based with both staticMap and resolver", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: { "client-1": ["toolset-a"] },
        resolver: (clientId: string) => ["toolset-b"],
      };
      expect(() => validatePermissionConfig(config)).not.toThrow();
    });

    it("accepts config with defaultPermissions", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: { "client-1": ["toolset-a"] },
        defaultPermissions: ["public"],
      };
      expect(() => validatePermissionConfig(config)).not.toThrow();
    });

    it("accepts staticMap with empty arrays", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: {
          "restricted-client": [],
        },
      };
      expect(() => validatePermissionConfig(config)).not.toThrow();
    });
  });

  describe("missing or invalid config object", () => {
    it("throws when config is null", () => {
      expect(() => validatePermissionConfig(null as any)).toThrow(
        "Permission configuration is required for createPermissionBasedMcpServer"
      );
    });

    it("throws when config is undefined", () => {
      expect(() => validatePermissionConfig(undefined as any)).toThrow(
        "Permission configuration is required for createPermissionBasedMcpServer"
      );
    });

    it("throws when config is not an object", () => {
      expect(() => validatePermissionConfig("invalid" as any)).toThrow(
        "Permission configuration is required for createPermissionBasedMcpServer"
      );
    });
  });

  describe("missing or invalid source field", () => {
    it("throws when source is missing", () => {
      const config = {} as PermissionConfig;
      expect(() => validatePermissionConfig(config)).toThrow(
        'Permission source must be either "headers" or "config"'
      );
    });

    it("throws when source is invalid", () => {
      const config = { source: "invalid" } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        'Invalid permission source: "invalid". Must be either "headers" or "config"'
      );
    });

    it("throws when source is empty string", () => {
      const config = { source: "" } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        'Permission source must be either "headers" or "config"'
      );
    });
  });

  describe("config source without staticMap or resolver", () => {
    it("throws when config source has neither staticMap nor resolver", () => {
      const config: PermissionConfig = {
        source: "config",
      };
      expect(() => validatePermissionConfig(config)).toThrow(
        "Config-based permissions require at least one of: staticMap or resolver function"
      );
    });

    it("throws when config source has both undefined", () => {
      const config: PermissionConfig = {
        source: "config",
        staticMap: undefined,
        resolver: undefined,
      };
      expect(() => validatePermissionConfig(config)).toThrow(
        "Config-based permissions require at least one of: staticMap or resolver function"
      );
    });
  });

  describe("invalid types", () => {
    it("throws when staticMap is not an object", () => {
      const config = {
        source: "config",
        staticMap: "not-an-object",
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        "staticMap must be an object mapping client IDs to toolset arrays"
      );
    });

    it("throws when staticMap is null", () => {
      const config = {
        source: "config",
        staticMap: null,
        resolver: () => [],
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        "staticMap must be an object mapping client IDs to toolset arrays"
      );
    });

    it("throws when staticMap is an array", () => {
      const config = {
        source: "config",
        staticMap: ["not", "an", "object"],
      } as any;
      // Arrays are objects in JS, so this gets caught at the value validation level
      expect(() => validatePermissionConfig(config)).toThrow(
        'staticMap value for client "0" must be an array of toolset names'
      );
    });

    it("throws when resolver is not a function", () => {
      const config = {
        source: "config",
        resolver: "not-a-function",
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        "resolver must be a synchronous function: (clientId: string) => string[]"
      );
    });

    it("throws when resolver is an object", () => {
      const config = {
        source: "config",
        resolver: { key: "value" },
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        "resolver must be a synchronous function: (clientId: string) => string[]"
      );
    });
  });

  describe("staticMap with non-array values", () => {
    it("throws when staticMap value is a string", () => {
      const config = {
        source: "config",
        staticMap: {
          "client-1": "toolset-a",
        },
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        'staticMap value for client "client-1" must be an array of toolset names'
      );
    });

    it("throws when staticMap value is an object", () => {
      const config = {
        source: "config",
        staticMap: {
          "client-1": { toolset: "a" },
        },
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        'staticMap value for client "client-1" must be an array of toolset names'
      );
    });

    it("throws when staticMap value is null", () => {
      const config = {
        source: "config",
        staticMap: {
          "client-1": null,
        },
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        'staticMap value for client "client-1" must be an array of toolset names'
      );
    });

    it("throws when staticMap has mixed valid and invalid values", () => {
      const config = {
        source: "config",
        staticMap: {
          "client-1": ["toolset-a"],
          "client-2": "invalid",
        },
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        'staticMap value for client "client-2" must be an array of toolset names'
      );
    });
  });

  describe("invalid headerName and defaultPermissions", () => {
    it("throws when headerName is empty string", () => {
      const config: PermissionConfig = {
        source: "headers",
        headerName: "",
      };
      expect(() => validatePermissionConfig(config)).toThrow(
        "headerName must be a non-empty string"
      );
    });

    it("throws when headerName is not a string", () => {
      const config = {
        source: "headers",
        headerName: 123,
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        "headerName must be a non-empty string"
      );
    });

    it("throws when defaultPermissions is not an array", () => {
      const config = {
        source: "config",
        staticMap: { "client-1": ["toolset-a"] },
        defaultPermissions: "not-an-array",
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        "defaultPermissions must be an array of toolset names"
      );
    });

    it("throws when defaultPermissions is an object", () => {
      const config = {
        source: "config",
        staticMap: { "client-1": ["toolset-a"] },
        defaultPermissions: { toolset: "a" },
      } as any;
      expect(() => validatePermissionConfig(config)).toThrow(
        "defaultPermissions must be an array of toolset names"
      );
    });
  });
});
