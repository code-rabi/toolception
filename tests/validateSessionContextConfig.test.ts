import { describe, it, expect } from "vitest";
import { validateSessionContextConfig } from "../src/session/session.utils.js";
import type { SessionContextConfig } from "../src/types/index.js";

describe("validateSessionContextConfig", () => {
  describe("valid configurations", () => {
    it("accepts minimal configuration", () => {
      const config: SessionContextConfig = {};
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts enabled: true", () => {
      const config: SessionContextConfig = {
        enabled: true,
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts enabled: false", () => {
      const config: SessionContextConfig = {
        enabled: false,
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts full queryParam configuration", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          name: "config",
          encoding: "base64",
          allowedKeys: ["key1", "key2"],
        },
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts json encoding", () => {
      const config: SessionContextConfig = {
        queryParam: {
          encoding: "json",
        },
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts contextResolver function", () => {
      const config: SessionContextConfig = {
        contextResolver: () => ({}),
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts shallow merge", () => {
      const config: SessionContextConfig = {
        merge: "shallow",
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts deep merge", () => {
      const config: SessionContextConfig = {
        merge: "deep",
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });

    it("accepts complete configuration", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          name: "session",
          encoding: "json",
          allowedKeys: ["API_TOKEN", "USER_ID"],
        },
        contextResolver: (req, base, parsed) => ({
          ...base,
          ...parsed,
        }),
        merge: "deep",
      };
      expect(() => validateSessionContextConfig(config)).not.toThrow();
    });
  });

  describe("invalid config object", () => {
    it("throws when config is null", () => {
      expect(() => validateSessionContextConfig(null as any)).toThrow(
        "Session context configuration must be an object"
      );
    });

    it("throws when config is undefined", () => {
      expect(() => validateSessionContextConfig(undefined as any)).toThrow(
        "Session context configuration must be an object"
      );
    });

    it("throws when config is not an object", () => {
      expect(() => validateSessionContextConfig("invalid" as any)).toThrow(
        "Session context configuration must be an object"
      );
    });

    it("throws when config is a number", () => {
      expect(() => validateSessionContextConfig(123 as any)).toThrow(
        "Session context configuration must be an object"
      );
    });
  });

  describe("invalid enabled field", () => {
    it("throws when enabled is a string", () => {
      const config = {
        enabled: "true",
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "enabled must be a boolean"
      );
    });

    it("throws when enabled is a number", () => {
      const config = {
        enabled: 1,
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "enabled must be a boolean"
      );
    });

    it("throws when enabled is null", () => {
      const config = {
        enabled: null,
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "enabled must be a boolean"
      );
    });
  });

  describe("invalid queryParam configuration", () => {
    it("throws when queryParam is not an object", () => {
      const config = {
        queryParam: "invalid",
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "queryParam must be an object"
      );
    });

    it("throws when queryParam is null", () => {
      const config = {
        queryParam: null,
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "queryParam must be an object"
      );
    });

    it("throws when queryParam.name is empty string", () => {
      const config: SessionContextConfig = {
        queryParam: {
          name: "",
        },
      };
      expect(() => validateSessionContextConfig(config)).toThrow(
        "queryParam.name must be a non-empty string"
      );
    });

    it("throws when queryParam.name is not a string", () => {
      const config = {
        queryParam: {
          name: 123,
        },
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "queryParam.name must be a non-empty string"
      );
    });

    it("throws when queryParam.encoding is invalid", () => {
      const config = {
        queryParam: {
          encoding: "invalid",
        },
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        'Invalid queryParam.encoding: "invalid". Must be "base64" or "json"'
      );
    });

    it("throws when queryParam.allowedKeys is not an array", () => {
      const config = {
        queryParam: {
          allowedKeys: "not-an-array",
        },
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "queryParam.allowedKeys must be an array of strings"
      );
    });

    it("throws when queryParam.allowedKeys contains non-string", () => {
      const config = {
        queryParam: {
          allowedKeys: ["valid", 123],
        },
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "queryParam.allowedKeys[1] must be a non-empty string"
      );
    });

    it("throws when queryParam.allowedKeys contains empty string", () => {
      const config: SessionContextConfig = {
        queryParam: {
          allowedKeys: ["valid", ""],
        },
      };
      expect(() => validateSessionContextConfig(config)).toThrow(
        "queryParam.allowedKeys[1] must be a non-empty string"
      );
    });
  });

  describe("invalid contextResolver", () => {
    it("throws when contextResolver is not a function", () => {
      const config = {
        contextResolver: "not-a-function",
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "contextResolver must be a function"
      );
    });

    it("throws when contextResolver is an object", () => {
      const config = {
        contextResolver: { key: "value" },
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        "contextResolver must be a function"
      );
    });
  });

  describe("invalid merge strategy", () => {
    it("throws when merge is invalid string", () => {
      const config = {
        merge: "invalid",
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        'Invalid merge strategy: "invalid". Must be "shallow" or "deep"'
      );
    });

    it("throws when merge is not a string", () => {
      const config = {
        merge: 123,
      } as any;
      expect(() => validateSessionContextConfig(config)).toThrow(
        'Invalid merge strategy: "123". Must be "shallow" or "deep"'
      );
    });
  });
});
