import type { Mode, ToolSetCatalog } from "../types/index.js";

export interface ModeResolverKeys {
  dynamic?: string[]; // keys that, when present/true, enable dynamic mode
  toolsets?: string[]; // keys that carry comma-separated toolsets
}

export interface ModeResolverOptions {
  keys?: ModeResolverKeys;
}

const DEFAULT_KEYS: Required<ModeResolverKeys> = {
  dynamic: ["dynamic-tool-discovery", "dynamicToolDiscovery", "DYNAMIC_TOOL_DISCOVERY"],
  toolsets: ["tool-sets", "toolSets", "FMP_TOOL_SETS"],
};

export class ModeResolver {
  private readonly keys: Required<ModeResolverKeys>;

  constructor(options: ModeResolverOptions = {}) {
    this.keys = {
      dynamic: options.keys?.dynamic ?? DEFAULT_KEYS.dynamic,
      toolsets: options.keys?.toolsets ?? DEFAULT_KEYS.toolsets,
    };
  }

  public resolveMode(env?: Record<string, string | undefined>, args?: Record<string, unknown>): Mode | null {
    // Check args first
    if (this.isDynamicEnabled(args)) return "DYNAMIC";

    const toolsetsFromArgs = this.getToolsetsString(args);
    if (toolsetsFromArgs) return "STATIC";

    // Check env next
    if (this.isDynamicEnabled(env)) return "DYNAMIC";

    const toolsetsFromEnv = this.getToolsetsString(env);
    if (toolsetsFromEnv) return "STATIC";

    return null; // no override
  }

  public parseCommaSeparatedToolSets(input: string, catalog: ToolSetCatalog): string[] {
    if (!input || typeof input !== "string") return [];
    const raw = input
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const valid = new Set(Object.keys(catalog));
    const result: string[] = [];
    for (const name of raw) {
      if (valid.has(name)) result.push(name);
      else console.warn(`Invalid toolset '${name}' ignored. Available: ${Array.from(valid).join(", ")}`);
    }
    return result;
  }

  public getModulesForToolSets(toolsets: string[], catalog: ToolSetCatalog): string[] {
    const modules = new Set<string>();
    for (const name of toolsets) {
      const def = catalog[name];
      if (!def) continue;
      (def.modules || []).forEach((m) => modules.add(m));
    }
    return Array.from(modules);
  }

  public validateToolsetName(name: unknown, catalog: ToolSetCatalog): { isValid: boolean; sanitized?: string; error?: string } {
    if (!name || typeof name !== "string") {
      return { isValid: false, error: `Invalid toolset name provided. Must be a non-empty string. Available toolsets: ${Object.keys(catalog).join(", ")}` };
    }
    const sanitized = name.trim();
    if (sanitized.length === 0) {
      return { isValid: false, error: `Empty toolset name provided. Available toolsets: ${Object.keys(catalog).join(", ")}` };
    }
    if (!catalog[sanitized]) {
      return { isValid: false, error: `Toolset '${sanitized}' not found. Available toolsets: ${Object.keys(catalog).join(", ")}` };
    }
    return { isValid: true, sanitized };
  }

  public validateToolsetModules(toolsetNames: string[], catalog: ToolSetCatalog): { isValid: boolean; modules?: string[]; error?: string } {
    try {
      const modules = this.getModulesForToolSets(toolsetNames, catalog);
      if (!modules || modules.length === 0) {
        return { isValid: false, error: `No modules found for toolsets: ${toolsetNames.join(", ")}` };
      }
      return { isValid: true, modules };
    } catch (error) {
      return { isValid: false, error: `Error resolving modules for ${toolsetNames.join(", ")}: ${error instanceof Error ? error.message : "Unknown error"}` };
    }
  }

  private isDynamicEnabled(source?: Record<string, unknown> | Record<string, string | undefined>): boolean {
    if (!source) return false;
    for (const key of this.keys.dynamic) {
      const value = (source as any)[key];
      if (value === true) return true;
      if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "true") return true;
      }
    }
    return false;
  }

  private getToolsetsString(source?: Record<string, unknown> | Record<string, string | undefined>): string | undefined {
    if (!source) return undefined;
    for (const key of this.keys.toolsets) {
      const value = (source as any)[key];
      if (typeof value === "string" && value.trim().length > 0) return value as string;
    }
    return undefined;
  }
}

