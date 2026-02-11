import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ExposurePolicy, ModuleLoader, Mode, ToolSetCatalog } from "../types/index.js";
import type { ModuleResolver } from "../mode/ModuleResolver.js";
import type { ToolRegistry } from "./ToolRegistry.js";

export interface ToolRegistryOptions {
  namespaceWithToolset?: boolean;
}

export interface DynamicToolManagerOptions {
  server: McpServer;
  resolver: ModuleResolver;
  context?: unknown;
  onToolsListChanged?: () => Promise<void> | void;
  exposurePolicy?: ExposurePolicy;
  toolRegistry?: ToolRegistry;
}

export interface ServerOrchestratorOptions {
  server: McpServer;
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, ModuleLoader>;
  exposurePolicy?: ExposurePolicy;
  context?: unknown;
  notifyToolsListChanged?: () => Promise<void> | void;
  startup?: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" };
  registerMetaTools?: boolean;
}
