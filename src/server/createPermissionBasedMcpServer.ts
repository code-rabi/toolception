import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreatePermissionBasedMcpServerOptions,
  ExposurePolicy,
} from "../types/index.js";
import { validatePermissionConfig } from "../permissions/validatePermissionConfig.js";
import { PermissionResolver } from "../permissions/PermissionResolver.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import { createPermissionAwareBundle } from "../permissions/createPermissionAwareBundle.js";
import { PermissionAwareFastifyTransport } from "../permissions/PermissionAwareFastifyTransport.js";

/**
 * Validates and sanitizes exposure policy for permission-based servers.
 * Certain policy options are not applicable or could conflict with permission-based access control.
 * @param policy - The original exposure policy
 * @returns Sanitized policy safe for permission-based servers
 * @private
 */
function sanitizeExposurePolicyForPermissions(
  policy?: ExposurePolicy
): ExposurePolicy | undefined {
  if (!policy) return undefined;

  const sanitized: ExposurePolicy = {
    namespaceToolsWithSetKey: policy.namespaceToolsWithSetKey,
  };

  // Warn about ignored options
  if (policy.allowlist !== undefined) {
    console.warn(
      "Permission-based servers: exposurePolicy.allowlist is ignored. " +
        "Allowed toolsets are determined by client permissions."
    );
  }
  if (policy.denylist !== undefined) {
    console.warn(
      "Permission-based servers: exposurePolicy.denylist is ignored. " +
        "Use permission configuration to control toolset access."
    );
  }
  if (policy.maxActiveToolsets !== undefined) {
    console.warn(
      "Permission-based servers: exposurePolicy.maxActiveToolsets is ignored. " +
        "Toolset count is determined by client permissions."
    );
  }
  if (policy.onLimitExceeded !== undefined) {
    console.warn(
      "Permission-based servers: exposurePolicy.onLimitExceeded is ignored. " +
        "No toolset limits are enforced."
    );
  }

  return sanitized;
}

/**
 * Creates an MCP server with permission-based toolset access control.
 *
 * This function provides a separate API for creating servers where each client receives
 * only the toolsets they're authorized to access. Each client gets a fresh server instance
 * with STATIC mode configured to their allowed toolsets, ensuring per-client isolation
 * without meta-tools or dynamic loading.
 *
 * The server supports two permission sources:
 * - **Header-based**: Permissions are read from request headers (e.g., `mcp-toolset-permissions`)
 * - **Config-based**: Permissions are resolved server-side using static maps or resolver functions
 *
 * @param options - Configuration options including permission settings, catalog, and HTTP transport options
 * @returns Server instance with `server`, `start()`, and `close()` methods matching the createMcpServer interface
 * @throws {Error} If permission configuration is invalid, missing, or if startup.mode is provided
 *
 * @example
 * // Header-based permissions
 * const server = await createPermissionBasedMcpServer({
 *   createServer: () => new McpServer({ name: "my-server", version: "1.0.0" }),
 *   catalog: { toolsetA: { name: "Toolset A", tools: [...] } },
 *   permissions: {
 *     source: 'headers',
 *     headerName: 'mcp-toolset-permissions' // optional, this is the default
 *   }
 * });
 *
 * @example
 * // Config-based permissions with static map
 * const server = await createPermissionBasedMcpServer({
 *   createServer: () => new McpServer({ name: "my-server", version: "1.0.0" }),
 *   catalog: { toolsetA: { name: "Toolset A", tools: [...] } },
 *   permissions: {
 *     source: 'config',
 *     staticMap: {
 *       'client-1': ['toolsetA', 'toolsetB'],
 *       'client-2': ['toolsetC']
 *     },
 *     defaultPermissions: [] // optional, defaults to empty array
 *   }
 * });
 *
 * @example
 * // Config-based permissions with resolver function
 * const server = await createPermissionBasedMcpServer({
 *   createServer: () => new McpServer({ name: "my-server", version: "1.0.0" }),
 *   catalog: { toolsetA: { name: "Toolset A", tools: [...] } },
 *   permissions: {
 *     source: 'config',
 *     resolver: (clientId) => {
 *       // Your custom logic to determine permissions
 *       return clientId.startsWith('admin-') ? ['toolsetA', 'toolsetB'] : ['toolsetA'];
 *     },
 *     defaultPermissions: ['toolsetA'] // fallback if resolver fails
 *   }
 * });
 */
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
  const permissionResolver = new PermissionResolver(options.permissions);

  // Create base server for default manager (used for status endpoints)
  const baseServer: McpServer = options.createServer();

  // Create base orchestrator for default manager (empty toolsets for status endpoint)
  // No notifier needed - STATIC mode with fixed toolsets per client
  const baseOrchestrator = new ServerOrchestrator({
    server: baseServer,
    catalog: options.catalog,
    moduleLoaders: options.moduleLoaders,
    exposurePolicy: sanitizedPolicy,
    context: options.context,
    notifyToolsListChanged: undefined, // No notifications in STATIC mode
    startup: { mode: "STATIC", toolsets: [] },
    registerMetaTools: false,
  });

  // Create permission-aware bundle creator
  const createBundle = createPermissionAwareBundle(
    (allowedToolsets: string[]) => {
      // Create fresh server and orchestrator for each client
      // Use STATIC mode but don't auto-enable toolsets in constructor
      // We'll enable them manually in createPermissionAwareBundle to ensure they're loaded before connection
      const clientServer: McpServer = options.createServer();
      const clientOrchestrator = new ServerOrchestrator({
        server: clientServer,
        catalog: options.catalog,
        moduleLoaders: options.moduleLoaders,
        exposurePolicy: sanitizedPolicy,
        context: options.context,
        notifyToolsListChanged: undefined, // No notifications in STATIC mode
        startup: { mode: "STATIC", toolsets: [] }, // Empty - we'll enable manually
        registerMetaTools: false, // No meta-tools - toolsets are fixed per client
      });
      return { server: clientServer, orchestrator: clientOrchestrator };
    },
    permissionResolver
  );

  // Create permission-aware transport
  const transport = new PermissionAwareFastifyTransport(
    baseOrchestrator.getManager(),
    createBundle,
    options.http,
    options.configSchema
  );

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
