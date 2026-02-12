import type { ToolSetCatalog, ModuleLoader } from "../types/index.js";

export interface ModeResolverKeys {
  dynamic?: string[];
  toolsets?: string[];
}

export interface ModeResolverOptions {
  keys?: ModeResolverKeys;
}

export const DEFAULT_KEYS: Required<ModeResolverKeys> = {
  dynamic: [
    "dynamic-tool-discovery",
    "dynamicToolDiscovery",
    "DYNAMIC_TOOL_DISCOVERY",
  ],
  toolsets: ["tool-sets", "toolSets", "FMP_TOOL_SETS"],
};

export const RESERVED_TOOLSET_KEYS = ["_meta"];

export interface ModuleResolverOptions {
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, ModuleLoader>;
}
