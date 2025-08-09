import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
