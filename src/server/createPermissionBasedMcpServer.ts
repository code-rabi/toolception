import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ExposurePolicy } from "../types/index.js";
import type {
  CreatePermissionBasedMcpServerOptions,
  McpServerHandle,
} from "./server.types.js";
import {
  validatePermissionConfig,
  createPermissionAwareBundle,
  sanitizeExposurePolicyForPermissions,
} from "../permissions/permissions.utils.js";
import { validateSessionContextConfig } from "../session/session.utils.js";
import { PermissionResolver } from "../permissions/PermissionResolver.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import { PermissionAwareFastifyTransport } from "../permissions/PermissionAwareFastifyTransport.js";

export async function createPermissionBasedMcpServer(
  options: CreatePermissionBasedMcpServerOptions
): Promise<McpServerHandle> {
  // --- Validate ---
  validatePermissionOptions(options);

  const sanitizedPolicy = sanitizeExposurePolicyForPermissions(options.exposurePolicy);
  const permissionResolver = buildPermissionResolver(options);

  // --- Base server & status-only orchestrator ---
  const baseServer: McpServer = options.createServer();
  const baseOrchestrator = buildPermissionOrchestrator(baseServer, options, sanitizedPolicy);

  // --- Per-client bundle factory ---
  const createBundle = createPermissionAwareBundle(
    createClientOrchestratorFactory(options, sanitizedPolicy),
    permissionResolver
  );

  // --- Transport ---
  const transport = buildPermissionTransport(options, baseOrchestrator.getManager(), createBundle);

  return {
    server: baseServer,
    start: () => transport.start(),
    close: async () => {
      try {
        await transport.stop();
      } finally {
        permissionResolver.clearCache();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Named helper functions
// ---------------------------------------------------------------------------

/**
 * Consolidates all upfront validation guards for permission-based servers.
 *
 * @param options - Server creation options to validate
 */
function validatePermissionOptions(
  options: CreatePermissionBasedMcpServerOptions
): void {
  if (!options.permissions) {
    throw new Error(
      "Permission configuration is required for createPermissionBasedMcpServer. " +
        "Please provide a 'permissions' field in the options."
    );
  }
  validatePermissionConfig(options.permissions);

  if (options.sessionContext) {
    validateSessionContextConfig(options.sessionContext);
    console.warn(
      "Session context support for permission-based servers is limited. " +
        "The base context will be used for module loaders."
    );
  }

  if ((options as any).startup) {
    throw new Error(
      "Permission-based servers determine toolsets from client permissions. " +
        "The 'startup' option is not allowed. Remove it from your configuration."
    );
  }

  if (typeof options.createServer !== "function") {
    throw new Error(
      "createPermissionBasedMcpServer: `createServer` (factory) is required"
    );
  }
}

/**
 * Builds a PermissionResolver from the options config.
 *
 * @param options - Server creation options containing permission config
 * @returns A configured PermissionResolver
 */
function buildPermissionResolver(
  options: CreatePermissionBasedMcpServerOptions
): PermissionResolver {
  const builder = PermissionResolver.builder()
    .source(options.permissions.source)
    .headerName(options.permissions.headerName ?? "mcp-toolset-permissions")
    .staticMap(options.permissions.staticMap ?? {})
    .defaultPermissions(options.permissions.defaultPermissions ?? []);

  if (options.permissions.resolver) {
    builder.resolver(options.permissions.resolver);
  }

  return builder.build();
}

/**
 * Builds a ServerOrchestrator configured for permission-based operation
 * (STATIC mode, empty toolsets, no meta-tools, no notifier).
 *
 * @param server - The MCP server instance
 * @param options - Server creation options (catalog, moduleLoaders, context)
 * @param policy - Sanitized exposure policy
 * @returns Orchestrator configured for permission-based operation
 */
function buildPermissionOrchestrator(
  server: McpServer,
  options: CreatePermissionBasedMcpServerOptions,
  policy: ExposurePolicy | undefined
): ServerOrchestrator {
  const builder = ServerOrchestrator.builder()
    .server(server)
    .catalog(options.catalog)
    .moduleLoaders(options.moduleLoaders ?? {})
    .context(options.context)
    .startup({ mode: "STATIC", toolsets: [] })
    .registerMetaTools(false);

  if (policy) {
    builder.exposurePolicy(policy);
  }

  return builder.build();
}

/**
 * Creates the callback that produces a fresh server + orchestrator per client,
 * scoped to the client's allowed toolsets.
 *
 * @param options - Server creation options
 * @param policy - Sanitized exposure policy
 * @returns Factory callback that accepts allowed toolsets and returns a server/orchestrator pair
 */
function createClientOrchestratorFactory(
  options: CreatePermissionBasedMcpServerOptions,
  policy: ExposurePolicy | undefined
): (allowedToolsets: string[]) => { server: McpServer; orchestrator: ServerOrchestrator } {
  return (allowedToolsets: string[]) => {
    const clientServer: McpServer = options.createServer();
    const clientOrchestrator = buildPermissionOrchestrator(clientServer, options, policy);
    return { server: clientServer, orchestrator: clientOrchestrator };
  };
}

/**
 * Builds the PermissionAwareFastifyTransport, handling conditional `.app()`
 * and `.customEndpoints()` chaining.
 *
 * @param options - Server creation options (http config)
 * @param manager - Default DynamicToolManager for status endpoints
 * @param createBundle - Permission-aware bundle creator
 * @returns A configured PermissionAwareFastifyTransport
 */
function buildPermissionTransport(
  options: CreatePermissionBasedMcpServerOptions,
  manager: ReturnType<ServerOrchestrator["getManager"]>,
  createBundle: ReturnType<typeof createPermissionAwareBundle>
): PermissionAwareFastifyTransport {
  const builder = PermissionAwareFastifyTransport.builder()
    .defaultManager(manager)
    .createPermissionAwareBundle(createBundle)
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

  return builder.build();
}
