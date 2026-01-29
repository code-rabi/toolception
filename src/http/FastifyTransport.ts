import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import type { DynamicToolManager } from "../core/DynamicToolManager.js";
import type { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import { ClientResourceCache } from "../session/ClientResourceCache.js";
import type { SessionContextResolver } from "../session/SessionContextResolver.js";
import type { SessionRequestContext } from "../types/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CustomEndpointDefinition } from "./customEndpoints.js";
import { registerCustomEndpoints } from "./endpointRegistration.js";

export interface FastifyTransportOptions {
  host?: string;
  port?: number;
  basePath?: string; // e.g. "/" or "/api"
  cors?: boolean;
  logger?: boolean;
  // Optional DI: provide a Fastify instance (e.g., for tests). If provided, start() will not listen.
  app?: FastifyInstance;
  /**
   * Optional custom HTTP endpoints to register alongside MCP protocol endpoints.
   * Allows adding REST-like endpoints with Zod validation and type inference.
   */
  customEndpoints?: CustomEndpointDefinition[];
}

/**
 * Callback type for creating a server bundle.
 * Accepts an optional merged context for per-session context support.
 */
export type CreateBundleCallback = (mergedContext?: unknown) => {
  server: McpServer;
  orchestrator: ServerOrchestrator;
};

export class FastifyTransport {
  private readonly options: {
    host: string;
    port: number;
    basePath: string;
    cors: boolean;
    logger: boolean;
    app?: FastifyInstance;
    customEndpoints?: CustomEndpointDefinition[];
  };
  private readonly defaultManager: DynamicToolManager;
  private readonly createBundle: CreateBundleCallback;
  private readonly sessionContextResolver?: SessionContextResolver;
  private readonly baseContext?: unknown;
  private app: FastifyInstance | null = null;
  private readonly configSchema?: object;

  // Per-client server bundles and per-client session transports
  private readonly clientCache = new ClientResourceCache<{
    server: McpServer;
    orchestrator: ServerOrchestrator;
    sessions: Map<string, StreamableHTTPServerTransport>;
  }>({
    onEvict: (_key, bundle) => {
      // Clean up all sessions when a client bundle is evicted
      this.cleanupBundle(bundle);
    },
  });

  constructor(
    defaultManager: DynamicToolManager,
    createBundle: CreateBundleCallback,
    options: FastifyTransportOptions = {},
    configSchema?: object,
    sessionContextResolver?: SessionContextResolver,
    baseContext?: unknown
  ) {
    this.defaultManager = defaultManager;
    this.createBundle = createBundle;
    this.sessionContextResolver = sessionContextResolver;
    this.baseContext = baseContext;
    this.options = {
      host: options.host ?? "0.0.0.0",
      port: options.port ?? 3000,
      basePath: options.basePath ?? "/",
      cors: options.cors ?? true,
      logger: options.logger ?? false,
      app: options.app,
      customEndpoints: options.customEndpoints,
    };
    this.configSchema = configSchema;
  }

  public async start(): Promise<void> {
    if (this.app) return;
    const app = this.options.app ?? Fastify({ logger: this.options.logger });
    if (this.options.cors) {
      await app.register(cors, { origin: true });
    }

    const base = this.options.basePath.endsWith("/")
      ? this.options.basePath.slice(0, -1)
      : this.options.basePath;

    app.get(`${base}/healthz`, async () => ({ ok: true }));

    app.get(`${base}/tools`, async () => this.defaultManager.getStatus());

    // Config discovery (placeholder schema)
    app.get(`${base}/.well-known/mcp-config`, async (_req, reply) => {
      reply.header("Content-Type", "application/schema+json; charset=utf-8");
      const baseSchema = this.configSchema ?? {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "MCP Session Configuration",
        description: "Schema for the /mcp endpoint configuration",
        type: "object",
        properties: {},
        required: [],
        "x-mcp-version": "1.0",
        "x-query-style": "dot+bracket",
      };
      return baseSchema;
    });

    // POST /mcp - JSON-RPC
    app.post(
      `${base}/mcp`,
      async (req: FastifyRequest, reply: FastifyReply) => {
        const clientIdHeader = (
          req.headers["mcp-client-id"] as string | undefined
        )?.trim();
        const clientId =
          clientIdHeader && clientIdHeader.length > 0
            ? clientIdHeader
            : `anon-${randomUUID()}`;

        // When anon id, avoid caching (one-off)
        const useCache = !clientId.startsWith("anon-");

        // Build session request context and resolve merged context
        const { cacheKey, mergedContext } = this.resolveSessionContext(
          req,
          clientId
        );

        let bundle = useCache ? this.clientCache.get(cacheKey) : null;
        if (!bundle) {
          const created = this.createBundle(mergedContext);
          bundle = {
            server: created.server,
            orchestrator: created.orchestrator,
            sessions: new Map(),
          };
          if (useCache) this.clientCache.set(cacheKey, bundle);
        }

        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        let transport: StreamableHTTPServerTransport | undefined;
        if (sessionId && bundle.sessions.get(sessionId)) {
          transport = bundle.sessions.get(sessionId)!;
        } else if (!sessionId && isInitializeRequest((req as any).body)) {
          const newSessionId = randomUUID();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
            onsessioninitialized: (sid: string) => {
              bundle!.sessions.set(sid, transport!);
            },
          });
          try {
            await bundle.server.connect(transport);
          } catch (error) {
            reply.code(500);
            return {
              jsonrpc: "2.0",
              error: { code: -32603, message: "Error initializing server." },
              id: null,
            };
          }
          transport.onclose = () => {
            if (transport?.sessionId)
              bundle!.sessions.delete(transport.sessionId);
          };
        } else {
          reply.code(400);
          return {
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session not found or expired" },
            id: null,
          };
        }

        // Delegate handling to SDK transport using raw Node req/res
        await transport.handleRequest(
          (req as any).raw,
          (reply as any).raw,
          (req as any).body
        );
        // Fastify will consider the response already sent by transport
        return reply;
      }
    );

    // GET /mcp - SSE notifications
    app.get(`${base}/mcp`, async (req: FastifyRequest, reply: FastifyReply) => {
      const clientIdHeader = (
        req.headers["mcp-client-id"] as string | undefined
      )?.trim();
      const clientId =
        clientIdHeader && clientIdHeader.length > 0 ? clientIdHeader : "";
      if (!clientId) {
        reply.code(400);
        return "Missing mcp-client-id";
      }
      const bundle = this.clientCache.get(clientId);
      if (!bundle) {
        reply.code(400);
        return "Invalid or expired client";
      }
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) {
        reply.code(400);
        return "Missing mcp-session-id";
      }
      const transport = bundle.sessions.get(sessionId);
      if (!transport) {
        reply.code(400);
        return "Invalid or expired session ID";
      }
      await transport.handleRequest((req as any).raw, (reply as any).raw);
      return reply;
    });

    // DELETE /mcp - terminate session
    app.delete(
      `${base}/mcp`,
      async (req: FastifyRequest, reply: FastifyReply) => {
        const clientIdHeader = (
          req.headers["mcp-client-id"] as string | undefined
        )?.trim();
        const clientId =
          clientIdHeader && clientIdHeader.length > 0 ? clientIdHeader : "";
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!clientId || !sessionId) {
          reply.code(400);
          return {
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Missing mcp-client-id or mcp-session-id header",
            },
            id: null,
          };
        }
        const bundle = this.clientCache.get(clientId);
        const transport = bundle?.sessions.get(sessionId);
        if (!bundle || !transport) {
          reply.code(404);
          return {
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session not found or expired" },
            id: null,
          };
        }
        try {
          // Best-effort close and evict
          if (typeof (transport as any).close === "function") {
            try {
              await (transport as any).close();
            } catch {}
          }
        } finally {
          if (transport?.sessionId) bundle.sessions.delete(transport.sessionId);
          else bundle.sessions.delete(sessionId);
        }
        reply.code(204).send();
        return reply;
      }
    );

    // Register custom endpoints if provided
    // IMPORTANT: Only register if customEndpoints is provided AND has items
    if (this.options.customEndpoints && this.options.customEndpoints.length > 0) {
      registerCustomEndpoints(app, base, this.options.customEndpoints);
    }

    // Only listen if we created the app
    if (!this.options.app) {
      await app.listen({ host: this.options.host, port: this.options.port });
    }
    this.app = app;
  }

  /**
   * Stops the Fastify server and cleans up all resources.
   * Closes all client sessions and clears the cache.
   */
  public async stop(): Promise<void> {
    if (!this.app) return;

    // Stop the cache pruning interval and clear all entries (triggers cleanup)
    this.clientCache.stop(true);

    if (!this.options.app) {
      await this.app.close();
    }
    this.app = null;
  }

  /**
   * Cleans up resources associated with a client bundle.
   * Closes all sessions within the bundle.
   * @param bundle - The client bundle to clean up
   * @private
   */
  private cleanupBundle(bundle: {
    server: McpServer;
    orchestrator: ServerOrchestrator;
    sessions: Map<string, StreamableHTTPServerTransport>;
  }): void {
    for (const [sessionId, transport] of bundle.sessions.entries()) {
      try {
        if (typeof (transport as any).close === "function") {
          (transport as any).close().catch((err: unknown) => {
            console.warn(`Error closing session ${sessionId}:`, err);
          });
        }
      } catch (err) {
        console.warn(`Error closing session ${sessionId}:`, err);
      }
    }
    bundle.sessions.clear();
  }

  /**
   * Resolves the session context and generates a cache key for the request.
   * If a session context resolver is configured, it extracts query parameters
   * and merges session-specific context with the base context.
   *
   * @param req - The Fastify request
   * @param clientId - The client identifier
   * @returns Object with cache key and merged context
   * @private
   */
  private resolveSessionContext(
    req: FastifyRequest,
    clientId: string
  ): { cacheKey: string; mergedContext: unknown } {
    // If no session context resolver, use simple clientId cache key
    if (!this.sessionContextResolver) {
      return {
        cacheKey: clientId,
        mergedContext: this.baseContext,
      };
    }

    // Build session request context
    const sessionRequestContext: SessionRequestContext = {
      clientId,
      headers: this.extractHeaders(req),
      query: this.extractQuery(req),
    };

    // Resolve the merged context
    const result = this.sessionContextResolver.resolve(
      sessionRequestContext,
      this.baseContext
    );

    // Build cache key: clientId:suffix
    const cacheKey =
      result.cacheKeySuffix === "default"
        ? clientId
        : `${clientId}:${result.cacheKeySuffix}`;

    return {
      cacheKey,
      mergedContext: result.context,
    };
  }

  /**
   * Extracts headers from a Fastify request as a Record.
   * Normalizes header names to lowercase.
   *
   * @param req - The Fastify request
   * @returns Headers as a string record
   * @private
   */
  private extractHeaders(req: FastifyRequest): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers[key.toLowerCase()] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        headers[key.toLowerCase()] = value[0];
      }
    }
    return headers;
  }

  /**
   * Extracts query parameters from a Fastify request as a Record.
   *
   * @param req - The Fastify request
   * @returns Query parameters as a string record
   * @private
   */
  private extractQuery(req: FastifyRequest): Record<string, string> {
    const query: Record<string, string> = {};
    const rawQuery = req.query as Record<string, unknown>;
    if (rawQuery && typeof rawQuery === "object") {
      for (const [key, value] of Object.entries(rawQuery)) {
        if (typeof value === "string") {
          query[key] = value;
        }
      }
    }
    return query;
  }
}
