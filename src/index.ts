// Public API: keep internals private; expose only the server factory and types

// Standard MCP server creation
export { createMcpServer } from "./server/createMcpServer.js";
export type { CreateMcpServerOptions } from "./server/createMcpServer.js";

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
  CreatePermissionBasedMcpServerOptions,
} from "./types/index.js";
