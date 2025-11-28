import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import type { DynamicToolManager } from "../core/DynamicToolManager.js";
import { ClientResourceCache } from "../session/ClientResourceCache.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import type {
  ClientRequestContext,
  PermissionAwareBundle,
} from "./createPermissionAwareBundle.js";

export interface PermissionAwareFastifyTransportOptions {
  host?: string;
  port?: number;
  basePath?: string;
  cors?: boolean;
  logger?: boolean;
  app?: FastifyInstance;
}

/**
 * Enhanced Fastify transport that supports permission-based toolset access.
 * Integrates with PermissionResolver to enforce per-client toolset permissions.
 * 
 * This transport extracts client context from requests and passes it to the
 * permission-aware bundle creator, ensuring each client receives only their
 * authorized toolsets while maintaining session management and caching.
 */
export class PermissionAwareFastifyTransport {
  private readonly options: {
    host: string;
    port: number;
    basePath: string;
    cors: boolean;
    logger: boolean;
    app?: FastifyInstance;
  };
  private readonly defaultManager: DynamicToolManager;
  private readonly createPermissionAwareBundle: (
    context: ClientRequestContext
  ) => Promise<PermissionAwareBundle>;
  private app: FastifyInstance | null = null;
  private readonly configSchema?: object;

  // Per-client server bundles and per-client session transports
  private readonly clientCache = new ClientResourceCache<{
    server: McpServer;
    orchestrator: ServerOrchestrator;
    sessions: Map<string, StreamableHTTPServerTransport>;
    allowedToolsets: string[];
    failedToolsets: string[];
  }>({
    onEvict: (_key, bundle) => {
      // Clean up all sessions when a client bundle is evicted
      this.#cleanupBundle(bundle);
    },
  });

  /**
   * Creates a new PermissionAwareFastifyTransport instance.
   * @param defaultManager - Default tool manager for status endpoints
   * @param createPermissionAwareBundle - Function to create permission-aware bundles
   * @param options - Transport configuration options
   * @param configSchema - Optional JSON schema for configuration discovery
   */
  constructor(
    defaultManager: DynamicToolManager,
    createPermissionAwareBundle: (
      context: ClientRequestContext
    ) => Promise<PermissionAwareBundle>,
    options: PermissionAwareFastifyTransportOptions = {},
    configSchema?: object
  ) {
    this.defaultManager = defaultManager;
    this.createPermissionAwareBundle = createPermissionAwareBundle;
    this.options = {
      host: options.host ?? "0.0.0.0",
      port: options.port ?? 3000,
      basePath: options.basePath ?? "/",
      cors: options.cors ?? true,
      logger: options.logger ?? false,
      app: options.app,
    };
    this.configSchema = configSchema;
  }

  /**
   * Starts the Fastify server and registers all MCP endpoints.
   * Sets up routes for health checks, tool status, and MCP protocol handling.
   */
  public async start(): Promise<void> {
    if (this.app) return;
    const app = this.options.app ?? Fastify({ logger: this.options.logger });
    if (this.options.cors) {
      await app.register(cors, { origin: true });
    }

    const base = this.#normalizeBasePath(this.options.basePath);

    this.#registerHealthEndpoint(app, base);
    this.#registerToolsEndpoint(app, base);
    this.#registerConfigDiscoveryEndpoint(app, base);
    this.#registerMcpPostEndpoint(app, base);
    this.#registerMcpGetEndpoint(app, base);
    this.#registerMcpDeleteEndpoint(app, base);

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
  #cleanupBundle(bundle: {
    server: McpServer;
    orchestrator: ServerOrchestrator;
    sessions: Map<string, StreamableHTTPServerTransport>;
    allowedToolsets: string[];
    failedToolsets: string[];
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
   * Normalizes the base path by removing trailing slashes.
   * @param basePath - The base path to normalize
   * @returns Normalized base path without trailing slash
   * @private
   */
  #normalizeBasePath(basePath: string): string {
    return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  }

  /**
   * Registers the health check endpoint.
   * @param app - Fastify instance
   * @param base - Base path for routes
   * @private
   */
  #registerHealthEndpoint(app: FastifyInstance, base: string): void {
    app.get(`${base}/healthz`, async () => ({ ok: true }));
  }

  /**
   * Registers the tools status endpoint.
   * @param app - Fastify instance
   * @param base - Base path for routes
   * @private
   */
  #registerToolsEndpoint(app: FastifyInstance, base: string): void {
    app.get(`${base}/tools`, async () => this.defaultManager.getStatus());
  }

  /**
   * Registers the MCP configuration discovery endpoint.
   * @param app - Fastify instance
   * @param base - Base path for routes
   * @private
   */
  #registerConfigDiscoveryEndpoint(app: FastifyInstance, base: string): void {
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
  }

  /**
   * Registers the POST /mcp endpoint for JSON-RPC requests.
   * Extracts client context, resolves permissions, and handles MCP protocol.
   * @param app - Fastify instance
   * @param base - Base path for routes
   * @private
   */
  #registerMcpPostEndpoint(app: FastifyInstance, base: string): void {
    app.post(
      `${base}/mcp`,
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Extract client context from request
        const context = this.#extractClientContext(req);

        // Determine if we should cache this client's bundle
        const useCache = !context.clientId.startsWith("anon-");

        // Get or create permission-aware bundle for this client
        let bundle = useCache ? this.clientCache.get(context.clientId) : null;
        if (!bundle) {
          try {
            const created = await this.createPermissionAwareBundle(context);

            // Log any failed toolsets for debugging
            if (created.failedToolsets.length > 0) {
              console.warn(
                `Client ${context.clientId} had ${created.failedToolsets.length} toolsets fail to enable: ` +
                  `[${created.failedToolsets.join(", ")}]. ` +
                  `Successfully enabled: [${created.allowedToolsets.join(", ")}]`
              );
            }

            const providedSessions = (created as { sessions?: Map<string, StreamableHTTPServerTransport> }).sessions;
            bundle = {
              server: created.server,
              orchestrator: created.orchestrator,
              allowedToolsets: created.allowedToolsets,
              failedToolsets: created.failedToolsets,
              sessions:
                providedSessions instanceof Map ? providedSessions : new Map(),
            };
            if (useCache) this.clientCache.set(context.clientId, bundle);
          } catch (error) {
            // Handle permission resolution or bundle creation failures
            console.error(
              `Failed to create permission-aware bundle for client ${context.clientId}:`,
              error
            );
            reply.code(403);
            return this.#createSafeErrorResponse("Access denied");
          }
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
        return reply;
      }
    );
  }

  /**
   * Registers the GET /mcp endpoint for SSE notifications.
   * @param app - Fastify instance
   * @param base - Base path for routes
   * @private
   */
  #registerMcpGetEndpoint(app: FastifyInstance, base: string): void {
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
  }

  /**
   * Registers the DELETE /mcp endpoint for session termination.
   * @param app - Fastify instance
   * @param base - Base path for routes
   * @private
   */
  #registerMcpDeleteEndpoint(app: FastifyInstance, base: string): void {
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
  }

  /**
   * Extracts client context from the request.
   * Generates anonymous client ID if not provided in headers.
   * @param req - Fastify request object
   * @returns Client request context with ID and headers
   * @private
   */
  #extractClientContext(req: FastifyRequest): ClientRequestContext {
    const clientIdHeader = (
      req.headers["mcp-client-id"] as string | undefined
    )?.trim();
    const clientId =
      clientIdHeader && clientIdHeader.length > 0
        ? clientIdHeader
        : `anon-${randomUUID()}`;

    // Convert headers to plain object for permission resolution
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }

    return { clientId, headers };
  }

  /**
   * Creates a safe error response that doesn't expose unauthorized toolset information.
   * Used for permission-related errors to prevent information leakage.
   * @param message - Generic error message to return to client
   * @param code - JSON-RPC error code (default: -32000 for server error)
   * @returns JSON-RPC error response object
   * @private
   */
  #createSafeErrorResponse(message: string = "Access denied", code: number = -32000) {
    return {
      jsonrpc: "2.0" as const,
      error: {
        code,
        message,
      },
      id: null,
    };
  }
}
