import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ModeResolver } from "../mode/ModeResolver.js";
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

  constructor(options: ServerOrchestratorOptions) {
    const modeResolver = new ModeResolver();
    const startup = options.startup ?? {};
    this.mode = startup.mode ?? "DYNAMIC";
    this.resolver = new ModuleResolver({
      catalog: options.catalog,
      moduleLoaders: options.moduleLoaders as any,
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
    const initial = startup.toolsets;
    if (initial === "ALL") {
      void this.manager.enableToolsets(this.resolver.getAvailableToolsets());
    } else if (Array.isArray(initial) && initial.length > 0) {
      void this.manager.enableToolsets(initial);
    }
  }

  public getMode(): Exclude<Mode, "ALL"> {
    return this.mode;
  }

  public getManager(): DynamicToolManager {
    return this.manager;
  }
}
