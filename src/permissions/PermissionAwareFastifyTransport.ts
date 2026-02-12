import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DynamicToolManager } from "../core/DynamicToolManager.js";
import { ClientResourceCache } from "../session/ClientResourceCache.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import type {
  ClientRequestContext,
  PermissionAwareBundle,
  PermissionAwareFastifyTransportOptions,
} from "./permissions.types.js";
import type { CustomEndpointDefinition } from "../http/http.types.js";
import { registerCustomEndpoints } from "../http/http.utils.js";

const mcpClientIdSchema = z
  .string({ message: "Missing required mcp-client-id header" })
  .trim()
  .min(1, "mcp-client-id header must not be empty");

export class PermissionAwareFastifyTransport {
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
      customEndpoints: options.customEndpoints,
    };
    this.configSchema = configSchema;
  }

  static builder() {
    let _defaultManager: DynamicToolManager;
    let _createPermissionAwareBundle: (context: ClientRequestContext) => Promise<PermissionAwareBundle>;
    const opts: PermissionAwareFastifyTransportOptions = {};
    let _configSchema: object | undefined;
    const builder = {
      defaultManager(value: DynamicToolManager) { _defaultManager = value; return builder; },
      createPermissionAwareBundle(value: (context: ClientRequestContext) => Promise<PermissionAwareBundle>) { _createPermissionAwareBundle = value; return builder; },
      host(value: string) { opts.host = value; return builder; },
      port(value: number) { opts.port = value; return builder; },
      basePath(value: string) { opts.basePath = value; return builder; },
      cors(value: boolean) { opts.cors = value; return builder; },
      logger(value: boolean) { opts.logger = value; return builder; },
      app(value: FastifyInstance) { opts.app = value; return builder; },
      customEndpoints(value: CustomEndpointDefinition[]) { opts.customEndpoints = value; return builder; },
      configSchema(value: object) { _configSchema = value; return builder; },
      build() { return new PermissionAwareFastifyTransport(_defaultManager, _createPermissionAwareBundle, opts, _configSchema); },
    };
    return builder;
  }

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

    // Register custom endpoints if provided with permission context
    // IMPORTANT: Only register if customEndpoints is provided AND has items
    if (this.options.customEndpoints && this.options.customEndpoints.length > 0) {
      registerCustomEndpoints(app, base, this.options.customEndpoints, {
        contextExtractor: async (req) => {
          // Extract client context from request
          const context = this.#extractClientContext(req);

          // Resolve permissions for this client
          try {
            const bundle = await this.createPermissionAwareBundle(context);
            return {
              allowedToolsets: bundle.allowedToolsets,
              failedToolsets: bundle.failedToolsets,
            };
          } catch (error) {
            // If permission resolution fails, return empty permissions
            console.warn(
              `Permission resolution failed for custom endpoint: ${error}`
            );
            return {
              allowedToolsets: [],
              failedToolsets: [],
            };
          }
        },
      });
    }

    // Only listen if we created the app
    if (!this.options.app) {
      await app.listen({ host: this.options.host, port: this.options.port });
    }
    this.app = app;
  }

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
   * @param bundle - The client bundle to clean up
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
   * @param basePath - The base path to normalize
   * @returns Normalized base path without trailing slash
   */
  #normalizeBasePath(basePath: string): string {
    return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  }

  /**
   * @param app - Fastify instance
   * @param base - Base path for routes
   */
  #registerHealthEndpoint(app: FastifyInstance, base: string): void {
    app.get(`${base}/healthz`, async () => ({ ok: true }));
  }

  /**
   * @param app - Fastify instance
   * @param base - Base path for routes
   */
  #registerToolsEndpoint(app: FastifyInstance, base: string): void {
    app.get(`${base}/tools`, async () => this.defaultManager.getStatus());
  }

  /**
   * @param app - Fastify instance
   * @param base - Base path for routes
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
   * @param app - Fastify instance
   * @param base - Base path for routes
   */
  #registerMcpPostEndpoint(app: FastifyInstance, base: string): void {
    app.post(
      `${base}/mcp`,
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Validate mcp-client-id header
        const parseResult = mcpClientIdSchema.safeParse(
          req.headers["mcp-client-id"]
        );
        if (!parseResult.success) {
          reply.code(400);
          return {
            jsonrpc: "2.0",
            error: { code: -32600, message: parseResult.error.issues[0].message },
            id: null,
          };
        }

        // Extract client context from request
        const context = this.#extractClientContext(req);

        // Get or create permission-aware bundle for this client
        let bundle = this.clientCache.get(context.clientId);
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
            this.clientCache.set(context.clientId, bundle);
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
   * @param app - Fastify instance
   * @param base - Base path for routes
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
   * @param app - Fastify instance
   * @param base - Base path for routes
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
   * @param req - Fastify request object
   * @returns Client request context with ID and headers
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
   * @param message - Generic error message to return to client
   * @param code - JSON-RPC error code
   * @returns JSON-RPC error response object
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
