import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ExposurePolicy, PermissionConfig } from "../types/index.js";
import type { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import type { PermissionResolver } from "./PermissionResolver.js";
import type {
  ClientRequestContext,
  PermissionAwareBundle,
} from "./permissions.types.js";

// --- Validation functions (from validatePermissionConfig.ts) ---

/**
 * Validates a permission configuration object to ensure it meets all requirements.
 * Throws descriptive errors for any validation failures.
 * @param config - The permission configuration to validate
 */
export function validatePermissionConfig(config: PermissionConfig): void {
  validateConfigExists(config);
  validateSourceField(config);
  validateConfigBasedPermissions(config);
  validateTypes(config);
}

/**
 * @param config - The permission configuration to validate
 */
function validateConfigExists(config: PermissionConfig): void {
  if (!config || typeof config !== "object") {
    throw new Error(
      "Permission configuration is required for createPermissionBasedMcpServer"
    );
  }
}

/**
 * @param config - The permission configuration to validate
 */
function validateSourceField(config: PermissionConfig): void {
  if (!config.source) {
    throw new Error('Permission source must be either "headers" or "config"');
  }

  if (config.source !== "headers" && config.source !== "config") {
    throw new Error(
      `Invalid permission source: "${config.source}". Must be either "headers" or "config"`
    );
  }
}

/**
 * @param config - The permission configuration to validate
 */
function validateConfigBasedPermissions(config: PermissionConfig): void {
  if (config.source === "config") {
    if (!config.staticMap && !config.resolver) {
      throw new Error(
        "Config-based permissions require at least one of: staticMap or resolver function"
      );
    }
  }
}

/**
 * @param config - The permission configuration to validate
 */
function validateTypes(config: PermissionConfig): void {
  if (config.staticMap !== undefined) {
    if (typeof config.staticMap !== "object" || config.staticMap === null) {
      throw new Error(
        "staticMap must be an object mapping client IDs to toolset arrays"
      );
    }

    // Validate that staticMap values are arrays
    validateStaticMapValues(config.staticMap);
  }

  if (config.resolver !== undefined) {
    if (typeof config.resolver !== "function") {
      throw new Error(
        "resolver must be a synchronous function: (clientId: string) => string[]"
      );
    }
  }

  if (config.defaultPermissions !== undefined) {
    if (!Array.isArray(config.defaultPermissions)) {
      throw new Error("defaultPermissions must be an array of toolset names");
    }
  }

  if (config.headerName !== undefined) {
    if (typeof config.headerName !== "string" || config.headerName.length === 0) {
      throw new Error("headerName must be a non-empty string");
    }
  }
}

/**
 * @param staticMap - The static map to validate
 */
function validateStaticMapValues(staticMap: Record<string, string[]>): void {
  for (const [clientId, permissions] of Object.entries(staticMap)) {
    if (!Array.isArray(permissions)) {
      throw new Error(
        `staticMap value for client "${clientId}" must be an array of toolset names`
      );
    }
  }
}

// --- createPermissionAwareBundle (from createPermissionAwareBundle.ts) ---

/**
 * Creates a permission-aware bundle creation function that wraps the original
 * createBundle function with permission resolution and enforcement.
 *
 * @param originalCreateBundle - Bundle creation function that accepts allowed toolsets
 * @param permissionResolver - Resolver instance for determining client permissions
 * @returns Enhanced bundle creation function that accepts client context
 */
export function createPermissionAwareBundle(
  originalCreateBundle: (allowedToolsets: string[]) => {
    server: McpServer;
    orchestrator: ServerOrchestrator;
  },
  permissionResolver: PermissionResolver
) {
  return async (
    context: ClientRequestContext
  ): Promise<PermissionAwareBundle> => {
    // Resolve permissions for this client
    const requestedToolsets = permissionResolver.resolvePermissions(
      context.clientId,
      context.headers
    );

    // Create bundle with allowed toolsets (STATIC mode pre-loads them)
    const bundle = originalCreateBundle(requestedToolsets);

    // Wait for toolsets to be enabled before returning
    // This ensures tools are registered before the server connects to transport
    const manager = bundle.orchestrator.getManager();

    const enabledToolsets: string[] = [];
    const failedToolsets: string[] = [];

    if (requestedToolsets.length > 0) {
      const result = await manager.enableToolsets(requestedToolsets);

      // Collect successful and failed toolsets
      for (const r of result.results) {
        if (r.success) {
          enabledToolsets.push(r.name);
        } else {
          failedToolsets.push(r.name);
          console.warn(
            `Failed to enable toolset '${r.name}' for client '${context.clientId}': ${r.message}`
          );
        }
      }

      // If ALL toolsets failed, this is likely a configuration error
      if (enabledToolsets.length === 0 && failedToolsets.length > 0) {
        throw new Error(
          `All requested toolsets failed to enable for client '${context.clientId}'. ` +
            `Requested: [${requestedToolsets.join(", ")}]. ` +
            `Check that toolset names in permissions match the catalog.`
        );
      }
    }

    // Return bundle with resolved permissions
    return {
      server: bundle.server,
      orchestrator: bundle.orchestrator,
      allowedToolsets: enabledToolsets,
      failedToolsets,
    };
  };
}

// --- sanitizeExposurePolicyForPermissions (from createPermissionBasedMcpServer.ts) ---

/**
 * Validates and sanitizes exposure policy for permission-based servers.
 * Certain policy options are not applicable or could conflict with permission-based access control.
 * @param policy - The original exposure policy
 * @returns Sanitized policy safe for permission-based servers
 */
export function sanitizeExposurePolicyForPermissions(
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
