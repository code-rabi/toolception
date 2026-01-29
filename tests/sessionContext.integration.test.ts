import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { FastifyTransport } from "../src/http/FastifyTransport.js";
import { SessionContextResolver } from "../src/session/SessionContextResolver.js";
import { DynamicToolManager } from "../src/core/DynamicToolManager.js";
import { ModuleResolver } from "../src/mode/ModuleResolver.js";
import { createFakeMcpServer } from "./helpers/fakes.js";
import type { SessionContextConfig, ToolSetCatalog } from "../src/types/index.js";

describe("Session Context Integration", () => {
  const createCatalog = (): ToolSetCatalog => ({
    core: { name: "Core", description: "Core tools", tools: [] },
  });

  describe("FastifyTransport with SessionContextResolver", () => {
    it("passes merged context to createBundle callback", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const sessionConfig: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
          allowedKeys: ["API_TOKEN"],
        },
      };
      const sessionContextResolver = new SessionContextResolver(sessionConfig);

      const baseContext = { baseValue: "original" };
      const createBundleSpy = vi.fn(() => ({
        server,
        orchestrator: {} as any,
      }));

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app },
        undefined,
        sessionContextResolver,
        baseContext
      );
      await transport.start();

      // Make request with session config
      const configJson = JSON.stringify({ API_TOKEN: "secret-token" });
      await app.inject({
        method: "POST",
        url: `/mcp?config=${encodeURIComponent(configJson)}`,
        headers: { "mcp-client-id": "test-client" },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });

      // Verify createBundle was called with merged context
      expect(createBundleSpy).toHaveBeenCalledWith({
        baseValue: "original",
        API_TOKEN: "secret-token",
      });

      await transport.stop();
    });

    it("uses base64 encoding by default", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const sessionConfig: SessionContextConfig = {
        enabled: true,
        queryParam: {
          allowedKeys: ["USER_ID"],
        },
      };
      const sessionContextResolver = new SessionContextResolver(sessionConfig);

      const createBundleSpy = vi.fn(() => ({
        server,
        orchestrator: {} as any,
      }));

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app },
        undefined,
        sessionContextResolver,
        {}
      );
      await transport.start();

      // Make request with base64-encoded config
      const configBase64 = Buffer.from('{"USER_ID":"12345"}').toString("base64");
      await app.inject({
        method: "POST",
        url: `/mcp?config=${encodeURIComponent(configBase64)}`,
        headers: { "mcp-client-id": "test-client" },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });

      expect(createBundleSpy).toHaveBeenCalledWith({ USER_ID: "12345" });

      await transport.stop();
    });

    it("filters disallowed keys silently", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const sessionConfig: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
          allowedKeys: ["allowed"],
        },
      };
      const sessionContextResolver = new SessionContextResolver(sessionConfig);

      const createBundleSpy = vi.fn(() => ({
        server,
        orchestrator: {} as any,
      }));

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app },
        undefined,
        sessionContextResolver,
        { base: true }
      );
      await transport.start();

      const configJson = JSON.stringify({
        allowed: "yes",
        forbidden: "should not appear",
        another_forbidden: "also filtered",
      });
      await app.inject({
        method: "POST",
        url: `/mcp?config=${encodeURIComponent(configJson)}`,
        headers: { "mcp-client-id": "test-client" },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });

      expect(createBundleSpy).toHaveBeenCalledWith({
        base: true,
        allowed: "yes",
      });

      await transport.stop();
    });

    it("uses different cache keys for different session configs", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const sessionConfig: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const sessionContextResolver = new SessionContextResolver(sessionConfig);

      let callCount = 0;
      const createBundleSpy = vi.fn(() => {
        callCount++;
        return {
          server,
          orchestrator: {} as any,
        };
      });

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app },
        undefined,
        sessionContextResolver,
        {}
      );
      await transport.start();

      const clientId = "same-client";

      // First request with config A
      await app.inject({
        method: "POST",
        url: `/mcp?config=${encodeURIComponent(JSON.stringify({ tenant: "A" }))}`,
        headers: { "mcp-client-id": clientId },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });
      expect(callCount).toBe(1);

      // Second request with same config A - should use cache
      await app.inject({
        method: "POST",
        url: `/mcp?config=${encodeURIComponent(JSON.stringify({ tenant: "A" }))}`,
        headers: { "mcp-client-id": clientId },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });
      expect(callCount).toBe(1); // Still 1, cached

      // Third request with config B - should create new bundle
      await app.inject({
        method: "POST",
        url: `/mcp?config=${encodeURIComponent(JSON.stringify({ tenant: "B" }))}`,
        headers: { "mcp-client-id": clientId },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });
      expect(callCount).toBe(2); // New bundle created

      await transport.stop();
    });

    it("passes base context when no session config provided", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const sessionConfig: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const sessionContextResolver = new SessionContextResolver(sessionConfig);
      const baseContext = { defaultKey: "defaultValue" };

      const createBundleSpy = vi.fn(() => ({
        server,
        orchestrator: {} as any,
      }));

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app },
        undefined,
        sessionContextResolver,
        baseContext
      );
      await transport.start();

      // Request without config query param
      await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { "mcp-client-id": "test-client" },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });

      expect(createBundleSpy).toHaveBeenCalledWith({ defaultKey: "defaultValue" });

      await transport.stop();
    });

    it("falls back to base context on invalid JSON config", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const sessionConfig: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
        },
      };
      const sessionContextResolver = new SessionContextResolver(sessionConfig);
      const baseContext = { fallback: true };

      const createBundleSpy = vi.fn(() => ({
        server,
        orchestrator: {} as any,
      }));

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app },
        undefined,
        sessionContextResolver,
        baseContext
      );
      await transport.start();

      // Request with invalid JSON
      await app.inject({
        method: "POST",
        url: "/mcp?config=not-valid-json",
        headers: { "mcp-client-id": "test-client" },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });

      expect(createBundleSpy).toHaveBeenCalledWith({ fallback: true });

      await transport.stop();
    });

    it("works without session context resolver (backward compatibility)", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const createBundleSpy = vi.fn(() => ({
        server,
        orchestrator: {} as any,
      }));

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app }
      );
      await transport.start();

      await app.inject({
        method: "POST",
        url: "/mcp?config=ignored",
        headers: { "mcp-client-id": "test-client" },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });

      // Without resolver, createBundle is called with undefined context
      expect(createBundleSpy).toHaveBeenCalledWith(undefined);

      await transport.stop();
    });
  });

  describe("custom context resolver", () => {
    it("uses custom resolver to build context", async () => {
      const { server } = createFakeMcpServer();
      const catalog = createCatalog();
      const resolver = new ModuleResolver({ catalog });
      const manager = new DynamicToolManager({ server, resolver });

      const sessionConfig: SessionContextConfig = {
        enabled: true,
        queryParam: {
          encoding: "json",
          allowedKeys: ["tenant"],
        },
        contextResolver: (request, baseContext, parsedConfig) => ({
          ...(baseContext as object),
          ...parsedConfig,
          clientId: request.clientId,
          timestamp: "fixed-for-test",
        }),
      };
      const sessionContextResolver = new SessionContextResolver(sessionConfig);

      const createBundleSpy = vi.fn(() => ({
        server,
        orchestrator: {} as any,
      }));

      const app = Fastify({ logger: false });
      const transport = new FastifyTransport(
        manager,
        createBundleSpy,
        { port: 0, logger: false, app },
        undefined,
        sessionContextResolver,
        { base: "value" }
      );
      await transport.start();

      await app.inject({
        method: "POST",
        url: `/mcp?config=${encodeURIComponent(JSON.stringify({ tenant: "acme" }))}`,
        headers: { "mcp-client-id": "my-client-id" },
        payload: { jsonrpc: "2.0", id: 1, method: "unknown", params: {} },
      });

      expect(createBundleSpy).toHaveBeenCalledWith({
        base: "value",
        tenant: "acme",
        clientId: "my-client-id",
        timestamp: "fixed-for-test",
      });

      await transport.stop();
    });
  });
});
