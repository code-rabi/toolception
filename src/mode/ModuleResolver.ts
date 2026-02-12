import type {
  ToolSetCatalog,
  ToolSetDefinition,
  McpToolDefinition,
  ModuleLoader,
} from "../types/index.js";
import type { ModuleResolverOptions } from "./mode.types.js";
import { RESERVED_TOOLSET_KEYS } from "./mode.types.js";

export class ModuleResolver {
  private readonly catalog: ToolSetCatalog;
  private readonly moduleLoaders: Record<string, ModuleLoader>;

  constructor(options: ModuleResolverOptions) {
    // Validate catalog doesn't use reserved keys
    for (const key of RESERVED_TOOLSET_KEYS) {
      if (key in options.catalog) {
        throw new Error(
          `Toolset key '${key}' is reserved for internal use and cannot be used in the catalog`
        );
      }
    }
    this.catalog = options.catalog;
    this.moduleLoaders = options.moduleLoaders ?? {};
  }

  static builder() {
    const opts: Partial<ModuleResolverOptions> = {};
    const builder = {
      catalog(value: ToolSetCatalog) { opts.catalog = value; return builder; },
      moduleLoaders(value: Record<string, ModuleLoader>) { opts.moduleLoaders = value; return builder; },
      build() { return new ModuleResolver(opts as ModuleResolverOptions); },
    };
    return builder;
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
    // Check for reserved keys (defense in depth)
    if (RESERVED_TOOLSET_KEYS.includes(sanitized)) {
      return {
        isValid: false,
        error: `Toolset key '${sanitized}' is reserved for internal use`,
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
      this.collectDirectTools(def, collected);
      await this.loadModuleTools(def, name, context, collected);
    }
    return collected;
  }

  /**
   * @param def - The toolset definition
   * @param collected - Mutable array to append direct tools to
   */
  private collectDirectTools(
    def: ToolSetDefinition,
    collected: McpToolDefinition[]
  ): void {
    if (Array.isArray(def.tools) && def.tools.length > 0) {
      collected.push(...def.tools);
    }
  }

  /**
   * @param def - The toolset definition containing module keys
   * @param toolsetName - The toolset name for error messages
   * @param context - Optional context passed to module loaders
   * @param collected - Mutable array to append loaded tools to
   */
  private async loadModuleTools(
    def: ToolSetDefinition,
    toolsetName: string,
    context: unknown,
    collected: McpToolDefinition[]
  ): Promise<void> {
    if (!Array.isArray(def.modules) || def.modules.length === 0) return;
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
          `Module loader '${modKey}' failed for toolset '${toolsetName}':`,
          err
        );
      }
    }
  }
}
