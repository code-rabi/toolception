import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mode } from "../types/index.js";
import type { CreateBundleCallback } from "../http/http.types.js";
import type { CreateMcpServerOptions, McpServerHandle } from "./server.types.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import { FastifyTransport } from "../http/FastifyTransport.js";
import { SessionContextResolver } from "../session/SessionContextResolver.js";
import { validateSessionContextConfig } from "../session/session.utils.js";
import {
  validateStartupConfig,
  createToolsChangedNotifier,
  resolveMetaToolsFlag,
} from "./server.utils.js";

export type { CreateMcpServerOptions } from "./server.types.js";

export async function createMcpServer(
  options: CreateMcpServerOptions
): Promise<McpServerHandle> {
  // --- Validate ---
  validateOptions(options);

  const mode: Exclude<Mode, "ALL"> = options.startup?.mode ?? "DYNAMIC";
  const shouldRegisterMetaTools = resolveMetaToolsFlag(options.registerMetaTools, mode);
  const sessionContextResolver = buildSessionContextResolver(options, mode);
  const notifyToolsChanged = createToolsChangedNotifier();

  // --- Build base server & orchestrator ---
  const baseServer: McpServer = options.createServer();
  const baseOrchestrator = buildOrchestrator(
    baseServer, options, mode, shouldRegisterMetaTools, notifyToolsChanged
  );

  if (mode === "STATIC") {
    await baseOrchestrator.ensureReady();
  }

  // --- Build transport ---
  const bundleFactory = createBundleFactory(
    options, mode, baseServer, baseOrchestrator, shouldRegisterMetaTools, notifyToolsChanged
  );
  const transport = buildTransport(
    options, baseOrchestrator.getManager(), bundleFactory, sessionContextResolver
  );

  return {
    server: baseServer,
    start: () => transport.start(),
    close: () => transport.stop(),
  };
}

// ---------------------------------------------------------------------------
// Named helper functions
// ---------------------------------------------------------------------------

/**
 * Consolidates all upfront validation guards.
 *
 * @param options - Server creation options to validate
 */
function validateOptions(options: CreateMcpServerOptions): void {
  if (options.startup) {
    validateStartupConfig(options.startup);
  }
  if (typeof options.createServer !== "function") {
    throw new Error("createMcpServer: `createServer` (factory) is required");
  }
}

/**
 * Validates session context config, builds the resolver, and warns about
 * limited utility in STATIC mode.
 *
 * @param options - Server creation options containing sessionContext config
 * @param mode - The resolved server mode
 * @returns A SessionContextResolver if configured, otherwise undefined
 */
function buildSessionContextResolver(
  options: CreateMcpServerOptions,
  mode: Exclude<Mode, "ALL">
): SessionContextResolver | undefined {
  if (!options.sessionContext) return undefined;

  validateSessionContextConfig(options.sessionContext);

  const resolver = SessionContextResolver.builder()
    .enabled(options.sessionContext.enabled ?? true)
    .queryParam(options.sessionContext.queryParam)
    .contextResolver(options.sessionContext.contextResolver)
    .merge(options.sessionContext.merge ?? "shallow")
    .build();

  if (mode === "STATIC" && options.sessionContext.enabled !== false) {
    console.warn(
      "sessionContext has limited effect in STATIC mode: all clients share the same server instance with base context. " +
        "Use DYNAMIC mode for per-session context isolation."
    );
  }

  return resolver;
}

/**
 * Builds a ServerOrchestrator with the standard configuration. Used once for
 * the base orchestrator and once per DYNAMIC client.
 *
 * @param server - The MCP server instance
 * @param options - Server creation options (catalog, moduleLoaders, exposurePolicy, startup)
 * @param mode - The resolved server mode
 * @param shouldRegisterMetaTools - Pre-resolved meta-tools flag
 * @param notifyToolsChanged - Notifier function for tool list changes
 * @param context - Optional context override (defaults to options.context)
 * @returns A configured ServerOrchestrator
 */
function buildOrchestrator(
  server: McpServer,
  options: CreateMcpServerOptions,
  mode: Exclude<Mode, "ALL">,
  shouldRegisterMetaTools: boolean,
  notifyToolsChanged: (target: unknown) => Promise<void>,
  context?: unknown
): ServerOrchestrator {
  const builder = ServerOrchestrator.builder()
    .server(server)
    .catalog(options.catalog)
    .moduleLoaders(options.moduleLoaders ?? {})
    .context(context !== undefined ? context : options.context)
    .notifyToolsListChanged(async () => notifyToolsChanged(server))
    .registerMetaTools(shouldRegisterMetaTools);

  if (options.exposurePolicy) {
    builder.exposurePolicy(options.exposurePolicy);
  }
  if (options.startup) {
    builder.startup(options.startup);
  }

  return builder.build();
}

/**
 * Creates the bundle factory callback for the transport layer.
 * In STATIC mode all clients share one server + orchestrator.
 * In DYNAMIC mode a fresh server + orchestrator is created per client.
 *
 * @param options - Server creation options
 * @param mode - STATIC reuses base bundle; DYNAMIC creates fresh per client
 * @param baseServer - The shared base server instance
 * @param baseOrchestrator - The shared base orchestrator
 * @param shouldRegisterMetaTools - Pre-resolved meta-tools flag
 * @param notifyToolsChanged - Notifier function for tool list changes
 * @returns Bundle factory callback for the transport layer
 */
function createBundleFactory(
  options: CreateMcpServerOptions,
  mode: Exclude<Mode, "ALL">,
  baseServer: McpServer,
  baseOrchestrator: ServerOrchestrator,
  shouldRegisterMetaTools: boolean,
  notifyToolsChanged: (target: unknown) => Promise<void>
): CreateBundleCallback {
  return (mergedContext?: unknown) => {
    if (mode === "STATIC") {
      // STATIC: all clients share one server + orchestrator
      return { server: baseServer, orchestrator: baseOrchestrator };
    }

    // DYNAMIC: fresh server + orchestrator per client
    const effectiveContext = mergedContext ?? options.context;
    const clientServer: McpServer = options.createServer();
    const clientOrchestrator = buildOrchestrator(
      clientServer, options, mode, shouldRegisterMetaTools, notifyToolsChanged, effectiveContext
    );
    return { server: clientServer, orchestrator: clientOrchestrator };
  };
}

/**
 * Builds the FastifyTransport using the builder pattern, handling conditional
 * `.app()`, `.customEndpoints()`, `.sessionContextResolver()`, and `.baseContext()` chaining.
 *
 * @param options - Server creation options (http, configSchema, context)
 * @param manager - Default DynamicToolManager for status endpoints
 * @param bundleFactory - Bundle factory callback for the transport layer
 * @param sessionContextResolver - Optional session context resolver
 * @returns A configured FastifyTransport
 */
function buildTransport(
  options: CreateMcpServerOptions,
  manager: ReturnType<ServerOrchestrator["getManager"]>,
  bundleFactory: CreateBundleCallback,
  sessionContextResolver: SessionContextResolver | undefined
): FastifyTransport {
  const builder = FastifyTransport.builder()
    .defaultManager(manager)
    .createBundle(bundleFactory)
    .host(options.http?.host ?? "0.0.0.0")
    .port(options.http?.port ?? 3000)
    .basePath(options.http?.basePath ?? "/")
    .cors(options.http?.cors ?? true)
    .logger(options.http?.logger ?? false);

  if (options.http?.app) {
    builder.app(options.http.app);
  }
  if (options.http?.customEndpoints) {
    builder.customEndpoints(options.http.customEndpoints);
  }
  if (options.configSchema) {
    builder.configSchema(options.configSchema);
  }
  if (sessionContextResolver) {
    builder.sessionContextResolver(sessionContextResolver);
  }
  if (options.context !== undefined) {
    builder.baseContext(options.context);
  }

  return builder.build();
}
