import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ExposurePolicy,
  Mode,
  ModuleLoader,
  SessionContextConfig,
  ToolSetCatalog,
} from "../types/index.js";
import type { FastifyTransportOptions } from "../http/http.types.js";

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
