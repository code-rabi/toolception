import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreatePermissionBasedMcpServerOptions,
} from "../types/index.js";
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
) {
  // Validate that permissions field is provided
  if (!options.permissions) {
    throw new Error(
      "Permission configuration is required for createPermissionBasedMcpServer. " +
        "Please provide a 'permissions' field in the options."
    );
  }

  // Validate permission configuration
  validatePermissionConfig(options.permissions);

  // Validate session context configuration if provided
  if (options.sessionContext) {
    validateSessionContextConfig(options.sessionContext);
    // Note: Session context is validated but not yet fully implemented
    // for permission-based servers. The base context is used for module loaders.
    console.warn(
      "Session context support for permission-based servers is limited. " +
        "The base context will be used for module loaders."
    );
  }

  // Prevent startup.mode configuration - permissions determine toolsets
  if ((options as any).startup) {
    throw new Error(
      "Permission-based servers determine toolsets from client permissions. " +
        "The 'startup' option is not allowed. Remove it from your configuration."
    );
  }

  // Validate createServer factory is provided
  if (typeof options.createServer !== "function") {
    throw new Error(
      "createPermissionBasedMcpServer: `createServer` (factory) is required"
    );
  }

  // Sanitize exposure policy for permission-based operation
  const sanitizedPolicy = sanitizeExposurePolicyForPermissions(
    options.exposurePolicy
  );

  // Create permission resolver instance
  const permissionResolver = PermissionResolver.builder()
    .source(options.permissions.source)
    .headerName(options.permissions.headerName ?? "mcp-toolset-permissions")
    .staticMap(options.permissions.staticMap ?? {})
    .resolver(options.permissions.resolver as (clientId: string) => string[])
    .defaultPermissions(options.permissions.defaultPermissions ?? [])
    .build();

  // Create base server for default manager (used for status endpoints)
  const baseServer: McpServer = options.createServer();

  // Create base orchestrator for default manager (empty toolsets for status endpoint)
  // No notifier needed - STATIC mode with fixed toolsets per client
  const baseOrchestrator = ServerOrchestrator.builder()
    .server(baseServer)
    .catalog(options.catalog)
    .moduleLoaders(options.moduleLoaders ?? {})
    .exposurePolicy(sanitizedPolicy!)
    .context(options.context)
    .startup({ mode: "STATIC", toolsets: [] })
    .registerMetaTools(false)
    .build();

  // Create permission-aware bundle creator
  const createBundle = createPermissionAwareBundle(
    (allowedToolsets: string[]) => {
      // Create fresh server and orchestrator for each client
      const clientServer: McpServer = options.createServer();
      const clientOrchestrator = ServerOrchestrator.builder()
        .server(clientServer)
        .catalog(options.catalog)
        .moduleLoaders(options.moduleLoaders ?? {})
        .exposurePolicy(sanitizedPolicy!)
        .context(options.context)
        .startup({ mode: "STATIC", toolsets: [] })
        .registerMetaTools(false)
        .build();
      return { server: clientServer, orchestrator: clientOrchestrator };
    },
    permissionResolver
  );

  // Create permission-aware transport
  const transportBuilder = PermissionAwareFastifyTransport.builder()
    .defaultManager(baseOrchestrator.getManager())
    .createPermissionAwareBundle(createBundle)
    .host(options.http?.host ?? "0.0.0.0")
    .port(options.http?.port ?? 3000)
    .basePath(options.http?.basePath ?? "/")
    .cors(options.http?.cors ?? true)
    .logger(options.http?.logger ?? false);

  if (options.http?.app) {
    transportBuilder.app(options.http.app);
  }
  if (options.http?.customEndpoints) {
    transportBuilder.customEndpoints(options.http.customEndpoints);
  }

  const transport = transportBuilder.build();

  // Return same interface as createMcpServer
  return {
    server: baseServer,
    start: async () => {
      await transport.start();
    },
    close: async () => {
      try {
        // Stop the transport (cleans up client contexts)
        await transport.stop();
      } finally {
        // Clear permission cache
        permissionResolver.clearCache();
      }
    },
  };
}
