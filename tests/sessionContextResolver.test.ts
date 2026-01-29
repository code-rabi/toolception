import { describe, it, expect, vi } from "vitest";
import { SessionContextResolver } from "../src/session/SessionContextResolver.js";
import type {
  SessionContextConfig,
  SessionRequestContext,
} from "../src/types/index.js";

describe("SessionContextResolver", () => {
  const createRequest = (
    overrides: Partial<SessionRequestContext> = {}
  ): SessionRequestContext => ({
    clientId: "test-client",
    headers: {},
    query: {},
    ...overrides,
  });

  describe("disabled mode", () => {
    it("returns base context when explicitly disabled", () => {
      const config: SessionContextConfig = {
        enabled: false,
      };
      const resolver = new SessionContextResolver(config);
      const baseContext = { foo: "bar" };

      const result = resolver.resolve(createRequest(), baseContext);

      expect(result.context).toEqual({ foo: "bar" });
      expect(result.cacheKeySuffix).toBe("default");
    });
  });

  describe("query parameter parsing", () => {
    describe("base64 encoding (default)", () => {
      it("parses base64-encoded JSON from default config param", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            allowedKeys: ["API_TOKEN"],
          },
        };
        const resolver = new SessionContextResolver(config);
        // {"API_TOKEN":"secret"} base64 encoded
        const encoded = Buffer.from('{"API_TOKEN":"secret"}').toString(
          "base64"
        );

        const result = resolver.resolve(
          createRequest({ query: { config: encoded } }),
          {}
        );

        expect(result.context).toEqual({ API_TOKEN: "secret" });
      });

      it("uses custom query param name", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            name: "session",
            allowedKeys: ["user_id"],
          },
        };
        const resolver = new SessionContextResolver(config);
        const encoded = Buffer.from('{"user_id":"123"}').toString("base64");

        const result = resolver.resolve(
          createRequest({ query: { session: encoded } }),
          {}
        );

        expect(result.context).toEqual({ user_id: "123" });
      });

      it("returns empty config for invalid base64", () => {
        const config: SessionContextConfig = {
          enabled: true,
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({ query: { config: "not-valid-base64!!!" } }),
          { base: "value" }
        );

        expect(result.context).toEqual({ base: "value" });
        expect(result.cacheKeySuffix).toBe("default");
      });

      it("returns empty config for invalid JSON after base64 decode", () => {
        const config: SessionContextConfig = {
          enabled: true,
        };
        const resolver = new SessionContextResolver(config);
        const encoded = Buffer.from("not json").toString("base64");

        const result = resolver.resolve(
          createRequest({ query: { config: encoded } }),
          { base: "value" }
        );

        expect(result.context).toEqual({ base: "value" });
      });
    });

    describe("json encoding", () => {
      it("parses JSON-encoded config param", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
            allowedKeys: ["token"],
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({ query: { config: '{"token":"abc"}' } }),
          {}
        );

        expect(result.context).toEqual({ token: "abc" });
      });

      it("returns empty config for invalid JSON", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({ query: { config: "not json" } }),
          { base: true }
        );

        expect(result.context).toEqual({ base: true });
      });
    });

    describe("missing query param", () => {
      it("returns base context when query param is missing", () => {
        const config: SessionContextConfig = {
          enabled: true,
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(createRequest(), { base: "context" });

        expect(result.context).toEqual({ base: "context" });
        expect(result.cacheKeySuffix).toBe("default");
      });
    });

    describe("non-object values", () => {
      it("returns empty config for array JSON", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({ query: { config: "[1,2,3]" } }),
          { base: true }
        );

        expect(result.context).toEqual({ base: true });
      });

      it("returns empty config for primitive JSON", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({ query: { config: '"string"' } }),
          { base: true }
        );

        expect(result.context).toEqual({ base: true });
      });

      it("returns empty config for null JSON", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({ query: { config: "null" } }),
          { base: true }
        );

        expect(result.context).toEqual({ base: true });
      });
    });
  });

  describe("allowed keys filtering", () => {
    it("filters to only allowed keys", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
          allowedKeys: ["allowed1", "allowed2"],
        },
      };
      const resolver = new SessionContextResolver(config);

      const result = resolver.resolve(
        createRequest({
          query: {
            config: JSON.stringify({
              allowed1: "yes",
              allowed2: "also yes",
              forbidden: "no",
            }),
          },
        }),
        {}
      );

      expect(result.context).toEqual({ allowed1: "yes", allowed2: "also yes" });
      expect(result.context).not.toHaveProperty("forbidden");
    });

    it("passes through all keys when no allowedKeys specified", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const resolver = new SessionContextResolver(config);

      const result = resolver.resolve(
        createRequest({
          query: { config: JSON.stringify({ any: "key", goes: "through" }) },
        }),
        {}
      );

      expect(result.context).toEqual({ any: "key", goes: "through" });
    });

    it("returns empty object when no allowed keys match", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
          allowedKeys: ["nonexistent"],
        },
      };
      const resolver = new SessionContextResolver(config);

      const result = resolver.resolve(
        createRequest({
          query: { config: JSON.stringify({ other: "value" }) },
        }),
        { base: "context" }
      );

      expect(result.context).toEqual({ base: "context" });
    });
  });

  describe("context merging", () => {
    describe("shallow merge (default)", () => {
      it("merges session config over base context", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: { config: JSON.stringify({ session: "value" }) },
          }),
          { base: "value", override: "original" }
        );

        expect(result.context).toEqual({
          base: "value",
          override: "original",
          session: "value",
        });
      });

      it("session config overrides base context values", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
          merge: "shallow",
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: { config: JSON.stringify({ shared: "from session" }) },
          }),
          { shared: "from base", other: "value" }
        );

        expect(result.context).toEqual({
          shared: "from session",
          other: "value",
        });
      });

      it("handles non-object base context", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: { config: JSON.stringify({ key: "value" }) },
          }),
          "not an object"
        );

        expect(result.context).toEqual({ key: "value" });
      });

      it("handles null base context", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: { config: JSON.stringify({ key: "value" }) },
          }),
          null
        );

        expect(result.context).toEqual({ key: "value" });
      });

      it("handles array base context", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: { config: JSON.stringify({ key: "value" }) },
          }),
          [1, 2, 3]
        );

        expect(result.context).toEqual({ key: "value" });
      });
    });

    describe("deep merge", () => {
      it("deep merges nested objects", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
          merge: "deep",
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: {
              config: JSON.stringify({
                nested: { sessionKey: "sessionValue" },
              }),
            },
          }),
          { nested: { baseKey: "baseValue" }, top: "level" }
        );

        expect(result.context).toEqual({
          nested: { baseKey: "baseValue", sessionKey: "sessionValue" },
          top: "level",
        });
      });

      it("session values override base values in deep merge", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
          merge: "deep",
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: {
              config: JSON.stringify({ nested: { shared: "from session" } }),
            },
          }),
          { nested: { shared: "from base", other: "value" } }
        );

        expect(result.context).toEqual({
          nested: { shared: "from session", other: "value" },
        });
      });

      it("handles arrays in deep merge (override, not merge)", () => {
        const config: SessionContextConfig = {
          enabled: true,
          queryParam: {
            encoding: "json",
          },
          merge: "deep",
        };
        const resolver = new SessionContextResolver(config);

        const result = resolver.resolve(
          createRequest({
            query: {
              config: JSON.stringify({ arr: [4, 5, 6] }),
            },
          }),
          { arr: [1, 2, 3] }
        );

        expect(result.context).toEqual({ arr: [4, 5, 6] });
      });
    });
  });

  describe("custom context resolver", () => {
    it("uses custom resolver function", () => {
      const customResolver = vi.fn(
        (request, baseContext, parsedConfig) => ({
          ...baseContext,
          ...parsedConfig,
          custom: "added",
          clientId: request.clientId,
        })
      );
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
        contextResolver: customResolver,
      };
      const resolver = new SessionContextResolver(config);

      const result = resolver.resolve(
        createRequest({
          clientId: "my-client",
          query: { config: JSON.stringify({ parsed: "value" }) },
        }),
        { base: "context" }
      );

      expect(customResolver).toHaveBeenCalled();
      expect(result.context).toEqual({
        base: "context",
        parsed: "value",
        custom: "added",
        clientId: "my-client",
      });
    });

    it("falls back to base context when resolver throws", () => {
      const config: SessionContextConfig = {
        enabled: true,
        contextResolver: () => {
          throw new Error("Resolver failed");
        },
      };
      const resolver = new SessionContextResolver(config);

      const result = resolver.resolve(createRequest(), { base: "context" });

      expect(result.context).toEqual({ base: "context" });
      expect(result.cacheKeySuffix).toBe("default");
    });

    it("receives parsed and filtered config", () => {
      const customResolver = vi.fn(
        (_request, baseContext, parsedConfig) => parsedConfig
      );
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
          allowedKeys: ["allowed"],
        },
        contextResolver: customResolver,
      };
      const resolver = new SessionContextResolver(config);

      resolver.resolve(
        createRequest({
          query: {
            config: JSON.stringify({ allowed: "yes", forbidden: "no" }),
          },
        }),
        {}
      );

      expect(customResolver).toHaveBeenCalledWith(
        expect.any(Object),
        {},
        { allowed: "yes" }
      );
    });
  });

  describe("cache key generation", () => {
    it("returns 'default' when no session config", () => {
      const config: SessionContextConfig = {
        enabled: true,
      };
      const resolver = new SessionContextResolver(config);

      const result = resolver.resolve(createRequest(), { base: true });

      expect(result.cacheKeySuffix).toBe("default");
    });

    it("generates hash for session config", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const resolver = new SessionContextResolver(config);

      const result = resolver.resolve(
        createRequest({
          query: { config: JSON.stringify({ key: "value" }) },
        }),
        {}
      );

      expect(result.cacheKeySuffix).not.toBe("default");
      expect(result.cacheKeySuffix).toHaveLength(16);
    });

    it("generates consistent hash for same config", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const resolver = new SessionContextResolver(config);
      const query = { config: JSON.stringify({ key: "value" }) };

      const result1 = resolver.resolve(createRequest({ query }), {});
      const result2 = resolver.resolve(createRequest({ query }), {});

      expect(result1.cacheKeySuffix).toBe(result2.cacheKeySuffix);
    });

    it("generates same hash regardless of key order", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const resolver = new SessionContextResolver(config);

      const result1 = resolver.resolve(
        createRequest({
          query: { config: JSON.stringify({ a: 1, b: 2 }) },
        }),
        {}
      );
      const result2 = resolver.resolve(
        createRequest({
          query: { config: JSON.stringify({ b: 2, a: 1 }) },
        }),
        {}
      );

      expect(result1.cacheKeySuffix).toBe(result2.cacheKeySuffix);
    });

    it("generates different hash for different config values", () => {
      const config: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const resolver = new SessionContextResolver(config);

      const result1 = resolver.resolve(
        createRequest({
          query: { config: JSON.stringify({ key: "value1" }) },
        }),
        {}
      );
      const result2 = resolver.resolve(
        createRequest({
          query: { config: JSON.stringify({ key: "value2" }) },
        }),
        {}
      );

      expect(result1.cacheKeySuffix).not.toBe(result2.cacheKeySuffix);
    });
  });
});
