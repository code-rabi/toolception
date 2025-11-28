import type { PermissionConfig } from "../types/index.js";

/**
 * Resolves and caches client permissions based on configured permission sources.
 * Supports both header-based and config-based permission resolution with caching
 * for performance optimization.
 */
export class PermissionResolver {
  private cache = new Map<string, string[]>();
  private readonly normalizedHeaderName: string;

  /**
   * Creates a new PermissionResolver instance.
   * @param config - The permission configuration defining how permissions are resolved
   */
  constructor(private config: PermissionConfig) {
    // Pre-normalize header name to lowercase for case-insensitive matching
    this.normalizedHeaderName = (
      config.headerName || "mcp-toolset-permissions"
    ).toLowerCase();
  }

  /**
   * Resolves permissions for a client based on the configured source.
   * Results are cached to improve performance for subsequent requests from the same client.
   * Handles all errors gracefully by returning empty permissions on failure.
   * 
   * Note on caching: For header-based permissions, permissions are cached by clientId.
   * This means subsequent requests from the same client will use cached permissions,
   * even if headers change. Use invalidateCache(clientId) to force re-resolution.
   * 
   * @param clientId - The unique identifier for the client
   * @param headers - Optional request headers (required for header-based permissions)
   * @returns Array of toolset names the client is allowed to access
   */
  resolvePermissions(
    clientId: string,
    headers?: Record<string, string>
  ): string[] {
    // Check cache first for performance
    if (this.cache.has(clientId)) {
      return this.cache.get(clientId)!;
    }

    let permissions: string[];

    try {
      if (this.config.source === "headers") {
        permissions = this.#parseHeaderPermissions(headers);
      } else {
        permissions = this.#resolveConfigPermissions(clientId);
      }

      // Validate that permissions is an array
      if (!Array.isArray(permissions)) {
        console.warn(
          `Permission resolution returned non-array for client ${clientId}, using empty permissions`
        );
        permissions = [];
      }

      // Filter out invalid toolset names (empty strings, non-strings)
      permissions = permissions.filter(
        (name) => typeof name === "string" && name.trim().length > 0
      );
    } catch (error) {
      // Catch any unexpected errors and apply most restrictive permissions
      console.error(
        `Unexpected error resolving permissions for client ${clientId}:`,
        error
      );
      permissions = [];
    }

    // Cache the resolved permissions
    this.cache.set(clientId, permissions);
    return permissions;
  }

  /**
   * Invalidates cached permissions for a specific client.
   * Call this when you know a client's permissions have changed.
   * @param clientId - The client ID to invalidate
   */
  invalidateCache(clientId: string): void {
    this.cache.delete(clientId);
  }

  /**
   * Parses permissions from request headers.
   * Extracts comma-separated toolset names from the configured header.
   * Handles malformed headers gracefully by returning empty permissions.
   * Uses case-insensitive header lookup per RFC 7230.
   * @param headers - Request headers containing permission data
   * @returns Array of toolset names from headers, or empty array if header is missing/malformed
   * @private
   */
  #parseHeaderPermissions(headers?: Record<string, string>): string[] {
    if (!headers) {
      return [];
    }

    // Find header value using case-insensitive lookup
    const headerValue = this.#findHeaderCaseInsensitive(
      headers,
      this.normalizedHeaderName
    );

    if (!headerValue) {
      return [];
    }

    try {
      // Parse comma-separated list, trim whitespace, and filter empty strings
      return headerValue
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } catch (error) {
      // Handle malformed headers gracefully
      console.warn(
        `Failed to parse permission header '${this.normalizedHeaderName}':`,
        error
      );
      return [];
    }
  }

  /**
   * Finds a header value using case-insensitive key matching.
   * HTTP headers are case-insensitive per RFC 7230.
   * @param headers - The headers object to search
   * @param normalizedKey - The lowercase key to search for
   * @returns The header value if found, undefined otherwise
   * @private
   */
  #findHeaderCaseInsensitive(
    headers: Record<string, string>,
    normalizedKey: string
  ): string | undefined {
    // Fast path: check if key exists as-is (common case with Fastify's lowercased headers)
    if (headers[normalizedKey] !== undefined) {
      return headers[normalizedKey];
    }
    // Slow path: iterate and compare lowercase
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === normalizedKey) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Resolves permissions from server-side configuration.
   * Tries resolver function first (if provided), then falls back to static map,
   * and finally to default permissions. Handles errors gracefully.
   * @param clientId - The unique identifier for the client
   * @returns Array of toolset names from configuration
   * @private
   */
  #resolveConfigPermissions(clientId: string): string[] {
    // Try resolver function first (if provided)
    if (this.config.resolver) {
      const resolverResult = this.#tryResolverFunction(clientId);
      if (resolverResult !== null) {
        return resolverResult;
      }
      // Fall through to static map or default if resolver fails
    }

    // Fall back to static map (if provided)
    if (this.config.staticMap) {
      const staticResult = this.#lookupStaticMap(clientId);
      if (staticResult !== null) {
        return staticResult;
      }
    }

    // Final fallback to default permissions
    return this.config.defaultPermissions || [];
  }

  /**
   * Attempts to resolve permissions using the configured resolver function.
   * Handles errors gracefully and returns null on failure to allow fallback.
   * @param clientId - The unique identifier for the client
   * @returns Array of toolset names if successful, null if resolver fails or returns invalid data
   * @private
   */
  #tryResolverFunction(clientId: string): string[] | null {
    try {
      const result = this.config.resolver!(clientId);
      if (Array.isArray(result)) {
        return result;
      }
      console.warn(
        `Permission resolver returned non-array for client ${clientId}, using fallback`
      );
      return null;
    } catch (error) {
      // Log message only, not full stack trace (this is expected fallback behavior)
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Permission resolver declined client ${clientId} (${message}), trying fallback`
      );
      return null;
    }
  }

  /**
   * Looks up permissions in the static map configuration.
   * Returns null if client is not found to allow fallback to defaults.
   * @param clientId - The unique identifier for the client
   * @returns Array of toolset names if found, null if client not in map
   * @private
   */
  #lookupStaticMap(clientId: string): string[] | null {
    const permissions = this.config.staticMap![clientId];
    if (permissions !== undefined) {
      return Array.isArray(permissions) ? permissions : [];
    }
    return null;
  }

  /**
   * Clears the permission cache.
   * Useful for cleanup during server shutdown or when permissions need to be refreshed.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
