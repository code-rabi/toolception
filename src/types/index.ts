import type { CreateMcpServerOptions } from "../server/createMcpServer.js";

// Loader concepts are internal-only; no public types for loaders

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (args: any) => Promise<any> | any;
};

export type ToolSetDefinition = {
  name: string;
  description: string;
  tools?: McpToolDefinition[];
  // Optional lazy-loaded modules that can contribute tools at runtime
  modules?: string[];
  decisionCriteria?: string;
};

export type ToolSetCatalog = Record<string, ToolSetDefinition>;

export type Mode = "DYNAMIC" | "STATIC" | "ALL";

export type ExposurePolicy = {
  maxActiveToolsets?: number;
  namespaceToolsWithSetKey?: boolean;
  allowlist?: string[];
  denylist?: string[];
  onLimitExceeded?: (attempted: string[], active: string[]) => void;
};

export type ToolingErrorCode =
  | "E_VALIDATION"
  | "E_POLICY_MAX_ACTIVE"
  | "E_TOOL_NAME_CONFLICT"
  | "E_NOTIFY_FAILED"
  | "E_INTERNAL";

// Module loader API: returns tools contributed by a module
// Module loader API: returns tools contributed by a module.
// Loaders may ignore the context argument if not needed.
export type ModuleLoader = (
  context?: unknown
) => Promise<McpToolDefinition[]> | McpToolDefinition[];

/**
 * Configuration for permission-based toolset access control.
 * 
 * Defines how client permissions are resolved and applied when using
 * `createPermissionBasedMcpServer`. Supports two permission sources:
 * 
 * **Header-based permissions**: Permissions are extracted from request headers.
 * This approach is simpler but requires proper authentication/authorization in your
 * application layer to prevent header tampering.
 * 
 * **Config-based permissions**: Permissions are resolved server-side using either
 * a static map or a resolver function. This provides stronger security by not
 * trusting client-provided permission data.
 * 
 * @example Header-based configuration
 * ```typescript
 * const config: PermissionConfig = {
 *   source: 'headers',
 *   headerName: 'mcp-toolset-permissions' // optional, this is the default
 * };
 * // Client sends: mcp-toolset-permissions: toolset-a,toolset-b
 * ```
 * 
 * @example Config-based with static map
 * ```typescript
 * const config: PermissionConfig = {
 *   source: 'config',
 *   staticMap: {
 *     'client-1': ['toolset-a', 'toolset-b'],
 *     'client-2': ['toolset-c']
 *   },
 *   defaultPermissions: [] // optional, for unknown clients
 * };
 * ```
 * 
 * @example Config-based with resolver function
 * ```typescript
 * const config: PermissionConfig = {
 *   source: 'config',
 *   resolver: (clientId: string) => {
 *     // Custom logic to determine permissions
 *     if (clientId.startsWith('admin-')) {
 *       return ['toolset-a', 'toolset-b', 'toolset-c'];
 *     }
 *     return ['toolset-a'];
 *   },
 *   defaultPermissions: ['toolset-a'] // fallback if resolver fails
 * };
 * ```
 */
export type PermissionConfig = {
  /**
   * The source of permission data.
   * 
   * - `'headers'`: Read permissions from request headers. Requires proper authentication
   *   in your application layer to prevent tampering.
   * - `'config'`: Use server-side permission configuration via staticMap or resolver.
   *   Provides stronger security by not trusting client-provided data.
   */
  source: "headers" | "config";

  /**
   * Name of the header containing permission data (for header-based permissions).
   * 
   * The header value should be a comma-separated list of toolset names.
   * Only used when `source` is `'headers'`.
   * 
   * @default 'mcp-toolset-permissions'
   * @example
   * ```typescript
   * // With default header name
   * { source: 'headers' }
   * // Client sends: mcp-toolset-permissions: toolset-a,toolset-b
   * 
   * // With custom header name
   * { source: 'headers', headerName: 'x-allowed-toolsets' }
   * // Client sends: x-allowed-toolsets: toolset-a,toolset-b
   * ```
   */
  headerName?: string;

  /**
   * Static mapping of client IDs to their allowed toolsets (for config-based permissions).
   * 
   * Each key is a client ID, and the value is an array of toolset names the client can access.
   * Only used when `source` is `'config'`. At least one of `staticMap` or `resolver` must
   * be provided for config-based permissions.
   * 
   * @example
   * ```typescript
   * {
   *   source: 'config',
   *   staticMap: {
   *     'client-1': ['toolset-a', 'toolset-b'],
   *     'client-2': ['toolset-c'],
   *     'admin-user': ['toolset-a', 'toolset-b', 'toolset-c']
   *   }
   * }
   * ```
   */
  staticMap?: Record<string, string[]>;

  /**
   * Synchronous function to resolve permissions for a client (for config-based permissions).
   * 
   * Called with the client ID and should return an array of allowed toolset names.
   * Only used when `source` is `'config'`. If both `staticMap` and `resolver` are provided,
   * the resolver takes precedence with staticMap as fallback.
   * 
   * The function should be synchronous and deterministic. If it throws an error or returns
   * a non-array value, the system falls back to `staticMap` or `defaultPermissions`.
   * 
   * @param clientId - The unique identifier for the client requesting access
   * @returns Array of toolset names the client is allowed to access
   * 
   * @example
   * ```typescript
   * {
   *   source: 'config',
   *   resolver: (clientId: string) => {
   *     // Integrate with your auth system
   *     const user = getUserFromCache(clientId);
   *     if (user.role === 'admin') {
   *       return ['toolset-a', 'toolset-b', 'toolset-c'];
   *     } else if (user.role === 'user') {
   *       return ['toolset-a'];
   *     }
   *     return [];
   *   }
   * }
   * ```
   */
  resolver?: (clientId: string) => string[];

  /**
   * Default permissions to apply when a client is not found in staticMap or resolver fails.
   * 
   * Used as a fallback when:
   * - Client ID is not found in `staticMap`
   * - `resolver` function throws an error or returns invalid data
   * - No other permission source provides valid permissions
   * 
   * If not specified, defaults to an empty array (no toolsets allowed).
   * 
   * @default []
   * @example
   * ```typescript
   * {
   *   source: 'config',
   *   staticMap: { 'known-client': ['toolset-a'] },
   *   defaultPermissions: ['public-toolset'] // Unknown clients get this
   * }
   * ```
   */
  defaultPermissions?: string[];
};

/**
 * Options for creating a permission-based MCP server.
 * 
 * Extends `CreateMcpServerOptions` but removes the `startup` field and requires
 * a `permissions` configuration. Permission-based servers automatically use DYNAMIC
 * mode internally to ensure per-client isolation, with each client receiving only
 * their authorized toolsets.
 * 
 * All standard options from `CreateMcpServerOptions` are supported, including:
 * - `createServer`: Factory function to create MCP server instances
 * - `catalog`: Toolset catalog defining available toolsets
 * - `moduleLoaders`: Optional lazy-loading modules for toolsets
 * - `exposurePolicy`: Optional policy for toolset exposure control
 * - `http`: HTTP transport configuration (host, port, CORS, etc.)
 * - `context`: Optional context passed to module loaders
 * 
 * @example Basic header-based server
 * ```typescript
 * const options: CreatePermissionBasedMcpServerOptions = {
 *   createServer: () => new McpServer({ name: "my-server", version: "1.0.0" }),
 *   catalog: {
 *     'toolset-a': { name: 'Toolset A', tools: [...] },
 *     'toolset-b': { name: 'Toolset B', tools: [...] }
 *   },
 *   permissions: {
 *     source: 'headers'
 *   },
 *   http: {
 *     port: 3000,
 *     cors: true
 *   }
 * };
 * ```
 * 
 * @example Config-based server with static map
 * ```typescript
 * const options: CreatePermissionBasedMcpServerOptions = {
 *   createServer: () => new McpServer({ name: "my-server", version: "1.0.0" }),
 *   catalog: {
 *     'toolset-a': { name: 'Toolset A', tools: [...] },
 *     'toolset-b': { name: 'Toolset B', tools: [...] }
 *   },
 *   permissions: {
 *     source: 'config',
 *     staticMap: {
 *       'client-1': ['toolset-a'],
 *       'client-2': ['toolset-a', 'toolset-b']
 *     },
 *     defaultPermissions: []
 *   }
 * };
 * ```
 */
export type CreatePermissionBasedMcpServerOptions = Omit<
  CreateMcpServerOptions,
  "startup"
> & {
  /**
   * Permission configuration defining how client access control is enforced.
   * 
   * This field is required for permission-based servers. It determines whether
   * permissions are read from request headers or resolved server-side using
   * static maps or resolver functions.
   * 
   * @see {@link PermissionConfig} for detailed configuration options and examples
   */
  permissions: PermissionConfig;

  /**
   * Startup configuration is not allowed for permission-based servers.
   * 
   * Permission-based servers automatically determine which toolsets to load for
   * each client based on the `permissions` configuration. The server internally
   * uses STATIC mode per client to ensure isolation and prevent dynamic toolset
   * changes during a session.
   * 
   * @deprecated Do not use - permission-based servers determine toolsets from client permissions
   */
  startup?: never;
};
