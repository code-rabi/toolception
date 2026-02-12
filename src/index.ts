// Public API: keep internals private; expose only the server factory and types

// Standard MCP server creation
export { createMcpServer } from "./server/createMcpServer.js";
export type { CreateMcpServerOptions, CreatePermissionBasedMcpServerOptions, McpServerHandle } from "./server/server.types.js";

// Permission-based MCP server creation (separate API for per-client toolset access control)
export { createPermissionBasedMcpServer } from "./server/createPermissionBasedMcpServer.js";

// Shared types and configuration interfaces
export type {
  ToolSetCatalog,
  ToolSetDefinition,
  McpToolDefinition,
  ExposurePolicy,
  Mode,
  ModuleLoader,
  PermissionConfig,
  SessionContextConfig,
  SessionRequestContext,
} from "./types/index.js";

// Session context support
export { SessionContextResolver } from "./session/SessionContextResolver.js";
export type { SessionContextResult } from "./session/session.types.js";

// Custom endpoint support
export type {
  CustomEndpointDefinition,
  CustomEndpointRequest,
  PermissionAwareEndpointRequest,
  CustomEndpointHandler,
  PermissionAwareEndpointHandler,
  HttpMethod,
  EndpointErrorResponse,
} from "./http/http.types.js";

export {
  defineEndpoint,
  definePermissionAwareEndpoint,
} from "./http/http.utils.js";
