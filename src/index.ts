// Public API: keep internals private; expose only the server factory and types
export { createMcpServer } from "./server/createMcpServer.js";
export type { CreateMcpServerOptions } from "./server/createMcpServer.js";
export type {
  ToolSetCatalog,
  ToolSetDefinition,
  McpToolDefinition,
  ExposurePolicy,
  Mode,
  ModuleLoader,
} from "./types/index.js";
