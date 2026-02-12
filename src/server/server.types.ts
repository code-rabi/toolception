import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ExposurePolicy,
  Mode,
  ModuleLoader,
  PermissionConfig,
  SessionContextConfig,
  ToolSetCatalog,
} from "../types/index.js";
import type { FastifyTransportOptions } from "../http/http.types.js";

/** Handle returned by both `createMcpServer` and `createPermissionBasedMcpServer`. */
export interface McpServerHandle {
  server: McpServer;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export interface CreateMcpServerOptions {
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, ModuleLoader>;
  exposurePolicy?: ExposurePolicy;
  context?: unknown;
  startup?: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" };
  registerMetaTools?: boolean;
  http?: FastifyTransportOptions;
  /**
   * Factory to create an MCP server instance. Required.
   * In DYNAMIC mode, a new instance is created per client bundle.
   * In STATIC mode, a single instance is created and reused across bundles.
   */
  createServer: () => McpServer;
  configSchema?: object;
  /**
   * Optional per-session context configuration.
   * Enables extracting context from query parameters and merging with base context
   * on a per-request basis. Useful for multi-tenant scenarios.
   *
   * @example
   * ```typescript
   * sessionContext: {
   *   enabled: true,
   *   queryParam: {
   *     name: 'config',
   *     encoding: 'base64',
   *     allowedKeys: ['API_TOKEN', 'USER_ID'],
   *   },
   *   merge: 'shallow',
   * }
   * ```
   */
  sessionContext?: SessionContextConfig;
}

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
