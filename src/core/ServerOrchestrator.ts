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

export class ServerOrchestrator {
  private readonly mode: Exclude<Mode, "ALL">;
  private readonly resolver: ModuleResolver;
  private readonly manager: DynamicToolManager;
  private readonly toolsetValidator: ToolsetValidator;
  private readonly initPromise: Promise<void>;
  private initError: Error | null = null;

  constructor(options: ServerOrchestratorOptions) {
    this.toolsetValidator = new ToolsetValidator();
    const startup = options.startup ?? {};
    const resolved = this.resolveStartupConfig(startup, options.catalog);
    this.mode = resolved.mode;
    this.resolver = new ModuleResolver({
      catalog: options.catalog,
      moduleLoaders: options.moduleLoaders,
    });
    const toolRegistry = new ToolRegistry({
      namespaceWithToolset:
        options.exposurePolicy?.namespaceToolsWithSetKey ?? true,
    });
    this.manager = new DynamicToolManager({
      server: options.server,
      resolver: this.resolver,
      context: options.context,
      onToolsListChanged: options.notifyToolsListChanged,
      exposurePolicy: options.exposurePolicy,
      toolRegistry,
    });

    // Register meta-tools only if requested (default true)
    if (options.registerMetaTools !== false) {
      registerMetaTools(options.server, this.manager, { mode: this.mode });
    }

    // Startup behavior - store promise for async initialization
    const initial = resolved.toolsets;
    this.initPromise = this.initializeToolsets(initial);
  }

  /**
   * Initializes toolsets asynchronously during construction.
   * Stores any errors for later retrieval via ensureReady().
   * @param initial - The toolsets to initialize or "ALL"
   * @returns Promise that resolves when initialization is complete
   * @private
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

  /**
   * Waits for the orchestrator to be fully initialized.
   * Call this before using the orchestrator to ensure all toolsets are loaded.
   * @throws {Error} If initialization failed
   */
  public async ensureReady(): Promise<void> {
    await this.initPromise;
    if (this.initError) {
      throw this.initError;
    }
  }

  /**
   * Checks if the orchestrator has finished initialization.
   * Does not throw on error - use ensureReady() for that.
   * @returns Promise that resolves to true if ready, false if initialization failed
   */
  public async isReady(): Promise<boolean> {
    await this.initPromise;
    return this.initError === null;
  }

  private resolveStartupConfig(
    startup: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" },
    catalog: ToolSetCatalog
  ): { mode: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" } {
    // Explicit mode dominates
    if (startup.mode) {
      if (startup.mode === "DYNAMIC" && startup.toolsets) {
        console.warn("startup.toolsets provided but ignored in DYNAMIC mode");
        return { mode: "DYNAMIC" };
      }
      if (startup.mode === "STATIC") {
        if (startup.toolsets === "ALL")
          return { mode: "STATIC", toolsets: "ALL" };
        const names = Array.isArray(startup.toolsets) ? startup.toolsets : [];
        const valid: string[] = [];
        for (const name of names) {
          const { isValid, sanitized, error } =
            this.toolsetValidator.validateToolsetName(name, catalog);
          if (isValid && sanitized) valid.push(sanitized);
          else if (error) console.warn(error);
        }
        if (names.length > 0 && valid.length === 0) {
          throw new Error(
            "STATIC mode requires valid toolsets or 'ALL'; none were valid"
          );
        }
        return { mode: "STATIC", toolsets: valid };
      }
      return { mode: startup.mode };
    }

    // No explicit mode; infer from toolsets
    if (startup.toolsets === "ALL") return { mode: "STATIC", toolsets: "ALL" };
    if (Array.isArray(startup.toolsets) && startup.toolsets.length > 0) {
      const valid: string[] = [];
      for (const name of startup.toolsets) {
        const { isValid, sanitized, error } =
          this.toolsetValidator.validateToolsetName(name, catalog);
        if (isValid && sanitized) valid.push(sanitized);
        else if (error) console.warn(error);
      }
      if (valid.length === 0) {
        throw new Error(
          "STATIC mode requires valid toolsets or 'ALL'; none were valid"
        );
      }
      return { mode: "STATIC", toolsets: valid };
    }

    // Default
    return { mode: "DYNAMIC" };
  }

  public getMode(): Exclude<Mode, "ALL"> {
    return this.mode;
  }

  public getManager(): DynamicToolManager {
    return this.manager;
  }
}
