import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ExposurePolicy,
  McpToolDefinition,
  ToolSetDefinition,
  ToolingErrorCode,
} from "../types/index.js";
import { ModuleResolver } from "../mode/ModuleResolver.js";
import { ToolRegistry } from "./ToolRegistry.js";

export interface DynamicToolManagerOptions {
  server: McpServer;
  resolver: ModuleResolver;
  context?: unknown;
  onToolsListChanged?: () => Promise<void> | void;
  exposurePolicy?: ExposurePolicy;
  toolRegistry?: ToolRegistry;
}

export class DynamicToolManager {
  private readonly server: McpServer;
  private readonly resolver: ModuleResolver;
  private readonly context?: unknown;
  private readonly onToolsListChanged?: () => Promise<void> | void;
  private readonly exposurePolicy?: ExposurePolicy;
  private readonly toolRegistry: ToolRegistry;

  private readonly activeToolsets = new Set<string>();

  constructor(options: DynamicToolManagerOptions) {
    this.server = options.server;
    this.resolver = options.resolver;
    this.context = options.context;
    this.onToolsListChanged = options.onToolsListChanged;
    this.exposurePolicy = options.exposurePolicy;
    this.toolRegistry =
      options.toolRegistry ?? new ToolRegistry({ namespaceWithToolset: true });
  }

  public getAvailableToolsets(): string[] {
    return this.resolver.getAvailableToolsets();
  }

  public getActiveToolsets(): string[] {
    return Array.from(this.activeToolsets);
  }

  public getToolsetDefinition(name: string): ToolSetDefinition | undefined {
    return this.resolver.getToolsetDefinition(name);
  }

  public isActive(name: string): boolean {
    return this.activeToolsets.has(name);
  }

  public async enableToolset(
    toolsetName: string
  ): Promise<{ success: boolean; message: string }> {
    const validation = this.resolver.validateToolsetName(toolsetName);
    if (!validation.isValid || !validation.sanitized) {
      return {
        success: false,
        message: validation.error || "Unknown validation error",
      };
    }
    const sanitized = validation.sanitized;
    if (this.activeToolsets.has(sanitized)) {
      return {
        success: false,
        message: `Toolset '${sanitized}' is already enabled.`,
      };
    }

    try {
      const resolvedTools = await this.resolver.resolveToolsForToolsets(
        [sanitized],
        this.context
      );

      // Exposure policy checks
      if (
        this.exposurePolicy?.allowlist &&
        !this.exposurePolicy.allowlist.includes(sanitized)
      ) {
        return {
          success: false,
          message: `Toolset '${sanitized}' is not allowed by policy.`,
        };
      }
      if (
        this.exposurePolicy?.denylist &&
        this.exposurePolicy.denylist.includes(sanitized)
      ) {
        return {
          success: false,
          message: `Toolset '${sanitized}' is denied by policy.`,
        };
      }
      if (this.exposurePolicy?.maxActiveToolsets !== undefined) {
        const next = this.activeToolsets.size + 1;
        if (next > this.exposurePolicy.maxActiveToolsets) {
          this.exposurePolicy.onLimitExceeded?.(
            [sanitized],
            Array.from(this.activeToolsets)
          );
          return {
            success: false,
            message: `Activation exceeds maxActiveToolsets (${this.exposurePolicy.maxActiveToolsets}).`,
          };
        }
      }

      // Register all resolved tools (direct + module-derived)
      if (resolvedTools && resolvedTools.length > 0) {
        const mapped = this.toolRegistry.mapAndValidate(
          sanitized,
          resolvedTools
        );
        this.registerDirectTools(mapped, sanitized);
      }

      // Track state (modules no longer tracked)
      this.activeToolsets.add(sanitized);

      // Notify list change
      try {
        await this.onToolsListChanged?.();
      } catch (err) {
        console.warn(`Failed to send tool list change notification:`, err);
      }

      return {
        success: true,
        message: `Toolset '${sanitized}' enabled successfully. Registered ${
          resolvedTools?.length ?? 0
        } tools.`,
      };
    } catch (error) {
      this.activeToolsets.delete(sanitized);
      return {
        success: false,
        message: `Failed to enable toolset '${sanitized}': ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  public async disableToolset(
    toolsetName: string
  ): Promise<{ success: boolean; message: string }> {
    const validation = this.resolver.validateToolsetName(toolsetName);
    if (!validation.isValid || !validation.sanitized) {
      const activeToolsets =
        Array.from(this.activeToolsets).join(", ") || "none";
      const base = validation.error || "Unknown validation error";
      return {
        success: false,
        message: `${base} Active toolsets: ${activeToolsets}`,
      };
    }
    const sanitized = validation.sanitized;
    if (!this.activeToolsets.has(sanitized)) {
      return {
        success: false,
        message: `Toolset '${sanitized}' is not currently active. Active toolsets: ${
          Array.from(this.activeToolsets).join(", ") || "none"
        }`,
      };
    }

    // State-only disable; no unregistration support in MCP
    this.activeToolsets.delete(sanitized);

    try {
      await this.onToolsListChanged?.();
    } catch (err) {
      console.warn(`Failed to send tool list change notification:`, err);
    }

    return {
      success: true,
      message: `Toolset '${sanitized}' disabled successfully. Individual tools remain registered due to MCP limitations.`,
    };
  }

  public getStatus() {
    return {
      availableToolsets: this.getAvailableToolsets(),
      activeToolsets: this.getActiveToolsets(),
      registeredModules: [],
      totalToolsets: this.getAvailableToolsets().length,
      activeCount: this.activeToolsets.size,
      tools: this.toolRegistry.list(),
      toolsetToTools: this.toolRegistry.listByToolset(),
    };
  }

  public async enableToolsets(toolsetNames: string[]): Promise<{
    success: boolean;
    results: Array<{
      name: string;
      success: boolean;
      message: string;
      code?: ToolingErrorCode;
    }>;
    message: string;
  }> {
    const results: Array<{
      name: string;
      success: boolean;
      message: string;
      code?: ToolingErrorCode;
    }> = [];
    for (const name of toolsetNames) {
      try {
        const res = await this.enableToolset(name);
        results.push({ name, ...res });
      } catch (err) {
        results.push({
          name,
          success: false,
          message: err instanceof Error ? err.message : "Unknown error",
          code: "E_INTERNAL",
        });
      }
    }
    const successAll = results.every((r) => r.success);
    const message = successAll
      ? "All toolsets enabled"
      : "Some toolsets failed to enable";
    if (results.length > 0) {
      try {
        await this.onToolsListChanged?.();
      } catch {}
    }
    return { success: successAll, results, message };
  }

  private registerDirectTools(
    tools: McpToolDefinition[],
    toolsetKey?: string
  ): void {
    for (const tool of tools) {
      try {
        this.server.tool(
          tool.name,
          tool.description,
          tool.inputSchema as any,
          async (args: any) => {
            return await tool.handler(args);
          }
        );
        if (toolsetKey) this.toolRegistry.addForToolset(toolsetKey, tool.name);
        else this.toolRegistry.add(tool.name);
      } catch (err) {
        console.error(`Failed to register direct tool '${tool.name}':`, err);
        throw err;
      }
    }
  }

  public async enableAllToolsets(): Promise<{
    success: boolean;
    results: Array<{
      name: string;
      success: boolean;
      message: string;
      code?: ToolingErrorCode;
    }>;
    message: string;
  }> {
    const all = this.getAvailableToolsets();
    return this.enableToolsets(all);
  }
}
