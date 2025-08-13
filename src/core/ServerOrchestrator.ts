import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolsetValidator } from "../mode/ToolsetValidator.js";
import { ModuleResolver } from "../mode/ModuleResolver.js";
import { DynamicToolManager } from "./DynamicToolManager.js";
import { registerMetaTools } from "../meta/registerMetaTools.js";
import type { ExposurePolicy, Mode, ToolSetCatalog } from "../types/index.js";
import { ToolRegistry } from "./ToolRegistry.js";

export interface ServerOrchestratorOptions {
  server: McpServer;
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, any>;
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

    // Startup behavior
    const initial = resolved.toolsets;
    if (initial === "ALL") {
      void this.manager.enableToolsets(this.resolver.getAvailableToolsets());
    } else if (Array.isArray(initial) && initial.length > 0) {
      void this.manager.enableToolsets(initial);
    }
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
