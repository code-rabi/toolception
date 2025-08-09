import type {
  ToolSetCatalog,
  ToolSetDefinition,
  McpToolDefinition,
  ModuleLoader,
} from "../types/index.js";

export interface ModuleResolverOptions {
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, ModuleLoader>;
}

export class ModuleResolver {
  private readonly catalog: ToolSetCatalog;
  private readonly moduleLoaders: Record<string, ModuleLoader>;

  constructor(options: ModuleResolverOptions) {
    this.catalog = options.catalog;
    this.moduleLoaders = options.moduleLoaders ?? {};
  }

  public getAvailableToolsets(): string[] {
    return Object.keys(this.catalog);
  }

  public getToolsetDefinition(name: string): ToolSetDefinition | undefined {
    return this.catalog[name];
  }

  public validateToolsetName(name: unknown): {
    isValid: boolean;
    sanitized?: string;
    error?: string;
  } {
    if (!name || typeof name !== "string") {
      return {
        isValid: false,
        error: `Invalid toolset name provided. Must be a non-empty string. Available toolsets: ${this.getAvailableToolsets().join(
          ", "
        )}`,
      };
    }
    const sanitized = name.trim();
    if (sanitized.length === 0) {
      return {
        isValid: false,
        error: `Empty toolset name provided. Available toolsets: ${this.getAvailableToolsets().join(
          ", "
        )}`,
      };
    }
    if (!this.catalog[sanitized]) {
      return {
        isValid: false,
        error: `Toolset '${sanitized}' not found. Available toolsets: ${this.getAvailableToolsets().join(
          ", "
        )}`,
      };
    }
    return { isValid: true, sanitized };
  }

  public async resolveToolsForToolsets(
    toolsets: string[],
    context?: unknown
  ): Promise<McpToolDefinition[]> {
    const collected: McpToolDefinition[] = [];
    for (const name of toolsets) {
      const def = this.catalog[name];
      if (!def) continue;
      if (Array.isArray(def.tools) && def.tools.length > 0) {
        collected.push(...def.tools);
      }
      if (Array.isArray(def.modules) && def.modules.length > 0) {
        for (const modKey of def.modules) {
          const loader = this.moduleLoaders[modKey];
          if (!loader) continue;
          try {
            const loaded = await loader(context);
            if (Array.isArray(loaded) && loaded.length > 0) {
              collected.push(...loaded);
            }
          } catch (err) {
            console.warn(
              `Module loader '${modKey}' failed for toolset '${name}':`,
              err
            );
          }
        }
      }
    }
    return collected;
  }
}
