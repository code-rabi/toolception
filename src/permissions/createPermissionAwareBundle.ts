import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import type { PermissionResolver } from "./PermissionResolver.js";

/**
 * Context information extracted from a client request.
 * Used to identify the client and resolve their permissions.
 */
export interface ClientRequestContext {
  /**
   * Unique identifier for the client making the request.
   * May be provided via mcp-client-id header or generated as anonymous ID.
   */
  clientId: string;

  /**
   * Request headers that may contain permission data.
   * Used for header-based permission resolution.
   */
  headers?: Record<string, string>;
}

/**
 * Result of permission-aware bundle creation, including the resolved permissions.
 */
export interface PermissionAwareBundle {
  /**
   * The MCP server instance for this client.
   */
  server: McpServer;

  /**
   * The orchestrator managing toolsets for this client.
   */
  orchestrator: ServerOrchestrator;

  /**
   * The resolved permissions (allowed toolsets) for this client.
   * Contains only the toolsets that were successfully enabled.
   */
  allowedToolsets: string[];

  /**
   * Toolsets that failed to enable (e.g., invalid names).
   * Empty if all requested toolsets were enabled successfully.
   */
  failedToolsets: string[];
}

/**
 * Creates a permission-aware bundle creation function that wraps the original
 * createBundle function with permission resolution and enforcement.
 *
 * This function resolves client permissions and passes them to the bundle creator,
 * which creates a server with STATIC mode configured to only those toolsets.
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
  /**
   * Creates a server bundle with permission-based toolset access control.
   * Resolves client permissions and creates a server with those toolsets pre-loaded.
   *
   * This function is async to ensure toolsets are fully loaded before the server
   * is connected to a transport.
   *
   * @param context - Client request context containing ID and headers
   * @returns Promise resolving to server bundle with resolved permissions
   * @throws {Error} If all requested toolsets fail to enable
   */
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
