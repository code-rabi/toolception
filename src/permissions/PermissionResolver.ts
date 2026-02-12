import type { PermissionConfig } from "../types/index.js";

export class PermissionResolver {
  private cache = new Map<string, string[]>();
  private readonly normalizedHeaderName: string;

  constructor(private config: PermissionConfig) {
    // Pre-normalize header name to lowercase for case-insensitive matching
    this.normalizedHeaderName = (
      config.headerName || "mcp-toolset-permissions"
    ).toLowerCase();
  }

  static builder() {
    const opts: Partial<PermissionConfig> = {};
    const builder = {
      source(value: "headers" | "config") { opts.source = value; return builder; },
      headerName(value: string) { opts.headerName = value; return builder; },
      staticMap(value: Record<string, string[]>) { opts.staticMap = value; return builder; },
      resolver(value: (clientId: string) => string[]) { opts.resolver = value; return builder; },
      defaultPermissions(value: string[]) { opts.defaultPermissions = value; return builder; },
      build() { return new PermissionResolver(opts as PermissionConfig); },
    };
    return builder;
  }

  /**
   * @param clientId - The unique identifier for the client
   * @param headers - Optional request headers
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
   * @param clientId - The client ID to invalidate
   */
  invalidateCache(clientId: string): void {
    this.cache.delete(clientId);
  }

  /**
   * @param headers - Request headers containing permission data
   * @returns Array of toolset names from headers
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
   * @param headers - The headers object to search
   * @param normalizedKey - The lowercase key to search for
   * @returns The header value if found
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
   * @param clientId - The unique identifier for the client
   * @returns Array of toolset names from configuration
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
   * @param clientId - The unique identifier for the client
   * @returns Array of toolset names if successful, null if resolver fails
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
   * @param clientId - The unique identifier for the client
   * @returns Array of toolset names if found, null if client not in map
   */
  #lookupStaticMap(clientId: string): string[] | null {
    const permissions = this.config.staticMap![clientId];
    if (permissions !== undefined) {
      return Array.isArray(permissions) ? permissions : [];
    }
    return null;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
