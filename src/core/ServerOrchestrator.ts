import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolsetValidator } from "../mode/ToolsetValidator.js";
import { ModuleResolver } from "../mode/ModuleResolver.js";
import { DynamicToolManager } from "./DynamicToolManager.js";
import { registerMetaTools } from "../meta/registerMetaTools.js";
import type {
  ExposurePolicy,
  Mode,
  ModuleLoader,
  ToolSetCatalog,
} from "../types/index.js";
import { ToolRegistry } from "./ToolRegistry.js";
import type { ServerOrchestratorOptions } from "./core.types.js";

export class ServerOrchestrator {
  private readonly mode: Exclude<Mode, "ALL">;
  private readonly resolver: ModuleResolver;
  private readonly manager: DynamicToolManager;
  private readonly toolsetValidator: ToolsetValidator;
  private readonly initPromise: Promise<void>;
  private initError: Error | null = null;

  constructor(options: ServerOrchestratorOptions) {
    this.toolsetValidator = ToolsetValidator.builder().build();
    const startup = options.startup ?? {};
    const resolved = this.resolveStartupConfig(startup, options.catalog);
    this.mode = resolved.mode;
    this.resolver = ModuleResolver.builder()
      .catalog(options.catalog)
      .moduleLoaders(options.moduleLoaders ?? {})
      .build();
    const toolRegistry = ToolRegistry.builder()
      .namespaceWithToolset(
        options.exposurePolicy?.namespaceToolsWithSetKey ?? true
      )
      .build();
    const managerBuilder = DynamicToolManager.builder()
      .server(options.server)
      .resolver(this.resolver)
      .context(options.context)
      .toolRegistry(toolRegistry);

    if (options.notifyToolsListChanged) {
      managerBuilder.onToolsListChanged(options.notifyToolsListChanged);
    }
    if (options.exposurePolicy) {
      managerBuilder.exposurePolicy(options.exposurePolicy);
    }

    this.manager = managerBuilder.build();

    // Register meta-tools only if requested (default true)
    if (options.registerMetaTools !== false) {
      registerMetaTools(options.server, this.manager, toolRegistry, { mode: this.mode });
    }

    // Startup behavior - store promise for async initialization
    const initial = resolved.toolsets;
    this.initPromise = this.initializeToolsets(initial);
  }

  static builder() {
    const opts: Partial<ServerOrchestratorOptions> = {};
    const builder = {
      server(value: McpServer) { opts.server = value; return builder; },
      catalog(value: ToolSetCatalog) { opts.catalog = value; return builder; },
      moduleLoaders(value: Record<string, ModuleLoader>) { opts.moduleLoaders = value; return builder; },
      exposurePolicy(value: ExposurePolicy) { opts.exposurePolicy = value; return builder; },
      context(value: unknown) { opts.context = value; return builder; },
      notifyToolsListChanged(value: () => Promise<void> | void) { opts.notifyToolsListChanged = value; return builder; },
      startup(value: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" }) { opts.startup = value; return builder; },
      registerMetaTools(value: boolean) { opts.registerMetaTools = value; return builder; },
      build() { return new ServerOrchestrator(opts as ServerOrchestratorOptions); },
    };
    return builder;
  }

  /**
   * @param initial - The toolsets to initialize or "ALL"
   * @returns Promise that resolves when initialization is complete
   */
  private async initializeToolsets(
    initial: string[] | "ALL" | undefined
  ): Promise<void> {
    try {
      if (initial === "ALL") {
        await this.manager.enableToolsets(this.resolver.getAvailableToolsets());
      } else if (Array.isArray(initial) && initial.length > 0) {
        await this.manager.enableToolsets(initial);
      }
    } catch (error) {
      this.initError =
        error instanceof Error ? error : new Error(String(error));
      console.error("Failed to initialize toolsets:", this.initError);
    }
  }

  public async ensureReady(): Promise<void> {
    await this.initPromise;
    if (this.initError) {
      throw this.initError;
    }
  }

  public async isReady(): Promise<boolean> {
    await this.initPromise;
    return this.initError === null;
  }

  private resolveStartupConfig(
    startup: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" },
    catalog: ToolSetCatalog
  ): { mode: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" } {
    if (startup.mode) {
      return this.resolveExplicitMode(startup.mode, startup.toolsets, catalog);
    }
    return this.inferModeFromToolsets(startup, catalog);
  }

  /**
   * @param mode - The explicit mode
   * @param toolsets - Optional toolsets from startup config
   * @param catalog - The toolset catalog to validate against
   * @returns Resolved mode and toolsets
   */
  private resolveExplicitMode(
    mode: Exclude<Mode, "ALL">,
    toolsets: string[] | "ALL" | undefined,
    catalog: ToolSetCatalog
  ): { mode: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" } {
    if (mode === "DYNAMIC" && toolsets) {
      console.warn("startup.toolsets provided but ignored in DYNAMIC mode");
      return { mode: "DYNAMIC" };
    }
    if (mode === "STATIC") {
      if (toolsets === "ALL")
        return { mode: "STATIC", toolsets: "ALL" };
      const names = Array.isArray(toolsets) ? toolsets : [];
      const valid = this.validateAndCollectToolsets(names, catalog);
      if (names.length > 0 && valid.length === 0) {
        throw new Error(
          "STATIC mode requires valid toolsets or 'ALL'; none were valid"
        );
      }
      return { mode: "STATIC", toolsets: valid };
    }
    return { mode };
  }

  /**
   * @param startup - Startup config without an explicit mode
   * @param catalog - The toolset catalog to validate against
   * @returns Inferred mode and toolsets
   */
  private inferModeFromToolsets(
    startup: { toolsets?: string[] | "ALL" },
    catalog: ToolSetCatalog
  ): { mode: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" } {
    if (startup.toolsets === "ALL") return { mode: "STATIC", toolsets: "ALL" };
    if (Array.isArray(startup.toolsets) && startup.toolsets.length > 0) {
      const valid = this.validateAndCollectToolsets(startup.toolsets, catalog);
      if (valid.length === 0) {
        throw new Error(
          "STATIC mode requires valid toolsets or 'ALL'; none were valid"
        );
      }
      return { mode: "STATIC", toolsets: valid };
    }
    return { mode: "DYNAMIC" };
  }

  /**
   * @param names - Array of toolset names to validate
   * @param catalog - The toolset catalog to validate against
   * @returns Array of valid, sanitized toolset names
   */
  private validateAndCollectToolsets(
    names: string[],
    catalog: ToolSetCatalog
  ): string[] {
    const valid: string[] = [];
    for (const name of names) {
      const { isValid, sanitized, error } =
        this.toolsetValidator.validateToolsetName(name, catalog);
      if (isValid && sanitized) valid.push(sanitized);
      else if (error) console.warn(error);
    }
    return valid;
  }

  public getMode(): Exclude<Mode, "ALL"> {
    return this.mode;
  }

  public getManager(): DynamicToolManager {
    return this.manager;
  }
}
