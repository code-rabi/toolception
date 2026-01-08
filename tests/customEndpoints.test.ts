import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCustomEndpoints } from "../src/http/endpointRegistration.js";
import { defineEndpoint, definePermissionAwareEndpoint } from "../src/http/customEndpoints.js";

describe("Custom Endpoints", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("defineEndpoint helper", () => {
    it("returns endpoint definition with correct structure", () => {
      const endpoint = defineEndpoint({
        method: "GET",
        path: "/test",
        querySchema: z.object({ id: z.string() }),
        responseSchema: z.object({ success: z.boolean() }),
        handler: async (req) => ({ success: true }),
      });

      expect(endpoint).toHaveProperty("method", "GET");
      expect(endpoint).toHaveProperty("path", "/test");
      expect(endpoint).toHaveProperty("querySchema");
      expect(endpoint).toHaveProperty("responseSchema");
      expect(endpoint).toHaveProperty("handler");
    });
  });

  describe("definePermissionAwareEndpoint helper", () => {
    it("returns endpoint definition compatible with permission-based servers", () => {
      const endpoint = definePermissionAwareEndpoint({
        method: "POST",
        path: "/admin",
        bodySchema: z.object({ action: z.string() }),
        responseSchema: z.object({ success: z.boolean() }),
        handler: async (req) => {
          // Should have access to allowedToolsets
          return { success: req.allowedToolsets.length > 0 };
        },
      });

      expect(endpoint).toHaveProperty("method", "POST");
      expect(endpoint).toHaveProperty("path", "/admin");
      expect(endpoint).toHaveProperty("bodySchema");
      expect(endpoint).toHaveProperty("handler");
    });
  });

  describe("registerCustomEndpoints", () => {
    describe("GET endpoint with query params", () => {
      it("validates and parses query parameters", async () => {
        const handler = vi.fn(async (req) => ({
          received: req.query,
        }));

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/users",
            querySchema: z.object({
              limit: z.coerce.number().int().positive(),
              offset: z.coerce.number().int().nonnegative().default(0),
            }),
            handler,
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/users?limit=10&offset=5",
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.received).toEqual({ limit: 10, offset: 5 });
        expect(handler).toHaveBeenCalledOnce();
      });

      it("returns validation error for invalid query params", async () => {
        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/users",
            querySchema: z.object({
              limit: z.coerce.number().int().positive(),
            }),
            handler: async () => ({ success: true }),
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/users?limit=-5",
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.message).toContain("query");
        expect(body.error.details).toBeDefined();
      });

      it("applies default values from schema", async () => {
        const handler = vi.fn(async (req) => ({ received: req.query }));

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/users",
            querySchema: z.object({
              limit: z.coerce.number().default(10),
            }),
            handler,
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/users",
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.received.limit).toBe(10);
      });
    });

    describe("POST endpoint with body validation", () => {
      it("validates and parses request body", async () => {
        const handler = vi.fn(async (req) => ({
          created: req.body,
        }));

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "POST",
            path: "/users",
            bodySchema: z.object({
              name: z.string().min(1),
              email: z.string().email(),
            }),
            handler,
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "POST",
          url: "/users",
          payload: {
            name: "Alice",
            email: "alice@example.com",
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.created).toEqual({
          name: "Alice",
          email: "alice@example.com",
        });
        expect(handler).toHaveBeenCalledOnce();
      });

      it("returns validation error for invalid body", async () => {
        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "POST",
            path: "/users",
            bodySchema: z.object({
              name: z.string().min(1),
              email: z.string().email(),
            }),
            handler: async () => ({ success: true }),
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "POST",
          url: "/users",
          payload: {
            name: "",
            email: "invalid-email",
          },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.message).toContain("body");
        expect(body.error.details).toHaveLength(2);
      });
    });

    describe("Path parameters", () => {
      it("validates and parses path parameters", async () => {
        const handler = vi.fn(async (req) => ({
          userId: req.params.userId,
        }));

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/users/:userId",
            paramsSchema: z.object({
              userId: z.string().uuid(),
            }),
            handler,
          }),
        ]);

        await app.ready();

        const validUuid = "123e4567-e89b-12d3-a456-426614174000";
        const response = await app.inject({
          method: "GET",
          url: `/users/${validUuid}`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.userId).toBe(validUuid);
        expect(handler).toHaveBeenCalledOnce();
      });

      it("returns validation error for invalid path params", async () => {
        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/users/:userId",
            paramsSchema: z.object({
              userId: z.string().uuid(),
            }),
            handler: async () => ({ success: true }),
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/users/invalid-uuid",
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.message).toContain("params");
      });
    });

    describe("Response validation", () => {
      it("validates response against schema", async () => {
        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/status",
            responseSchema: z.object({
              status: z.string(),
              code: z.number(),
            }),
            handler: async () => ({
              status: "ok",
              code: 200,
            }),
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/status",
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).toEqual({ status: "ok", code: 200 });
      });

      it("returns 500 if response validation fails", async () => {
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/status",
            responseSchema: z.object({
              status: z.string(),
              code: z.number(),
            }),
            handler: async () => ({
              status: "ok",
              // Missing required 'code' field
            } as any),
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/status",
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe("RESPONSE_VALIDATION_ERROR");
        expect(body.error.message).toContain("invalid response format");

        consoleErrorSpy.mockRestore();
      });
    });

    describe("Client ID handling", () => {
      it("extracts client ID from header", async () => {
        const handler = vi.fn(async (req) => ({
          clientId: req.clientId,
        }));

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/me",
            handler,
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/me",
          headers: {
            "mcp-client-id": "test-client-123",
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.clientId).toBe("test-client-123");
      });

      it("generates anonymous client ID when header missing", async () => {
        const handler = vi.fn(async (req) => ({
          clientId: req.clientId,
        }));

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/me",
            handler,
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/me",
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.clientId).toMatch(/^anon-/);
      });
    });

    describe("Error handling", () => {
      it("handles handler errors gracefully", async () => {
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/error",
            handler: async () => {
              throw new Error("Something went wrong");
            },
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/error",
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe("INTERNAL_ERROR");
        expect(body.error.message).toBe("Something went wrong");

        consoleErrorSpy.mockRestore();
      });
    });

    describe("Context extractor", () => {
      it("merges additional context into request", async () => {
        const handler = vi.fn(async (req: any) => ({
          hasPermissions: "allowedToolsets" in req,
          toolsets: req.allowedToolsets,
        }));

        registerCustomEndpoints(
          app,
          "",
          [
            defineEndpoint({
              method: "GET",
              path: "/admin",
              handler,
            }),
          ],
          {
            contextExtractor: async () => ({
              allowedToolsets: ["admin", "user"],
              failedToolsets: [],
            }),
          }
        );

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/admin",
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.hasPermissions).toBe(true);
        expect(body.toolsets).toEqual(["admin", "user"]);
      });
    });

    describe("Base path handling", () => {
      it("registers endpoints with base path", async () => {
        registerCustomEndpoints(app, "/api", [
          defineEndpoint({
            method: "GET",
            path: "/status",
            handler: async () => ({ ok: true }),
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/api/status",
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe("Reserved path conflicts", () => {
      it("skips registration and warns for conflicting paths", async () => {
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/mcp",
            handler: async () => ({ ok: true }),
          }),
          defineEndpoint({
            method: "GET",
            path: "/healthz",
            handler: async () => ({ ok: true }),
          }),
          defineEndpoint({
            method: "GET",
            path: "/tools",
            handler: async () => ({ ok: true }),
          }),
        ]);

        await app.ready();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("/mcp")
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("/healthz")
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("/tools")
        );

        consoleWarnSpy.mockRestore();
      });
    });

    describe("All HTTP methods", () => {
      it.each(["GET", "POST", "PUT", "DELETE", "PATCH"] as const)(
        "supports %s method",
        async (method) => {
          registerCustomEndpoints(app, "", [
            defineEndpoint({
              method,
              path: "/test",
              handler: async () => ({ method }),
            }),
          ]);

          await app.ready();

          const response = await app.inject({
            method,
            url: "/test",
          });

          expect(response.statusCode).toBe(200);
          const body = JSON.parse(response.body);
          expect(body.method).toBe(method);
        }
      );
    });

    describe("Headers access", () => {
      it("provides access to request headers", async () => {
        const handler = vi.fn(async (req) => ({
          hasCustomHeader: "x-custom-header" in req.headers,
          customValue: req.headers["x-custom-header"],
        }));

        registerCustomEndpoints(app, "", [
          defineEndpoint({
            method: "GET",
            path: "/headers",
            handler,
          }),
        ]);

        await app.ready();

        const response = await app.inject({
          method: "GET",
          url: "/headers",
          headers: {
            "x-custom-header": "custom-value",
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.hasCustomHeader).toBe(true);
        expect(body.customValue).toBe("custom-value");
      });
    });
  });
});
