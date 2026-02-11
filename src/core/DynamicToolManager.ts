import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ExposurePolicy,
  McpToolDefinition,
  ToolSetDefinition,
  ToolingErrorCode,
} from "../types/index.js";
import { ModuleResolver } from "../mode/ModuleResolver.js";
import { ToolRegistry } from "./ToolRegistry.js";
import type { DynamicToolManagerOptions } from "./core.types.js";

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
      options.toolRegistry ?? ToolRegistry.builder().namespaceWithToolset(true).build();
  }

  static builder() {
    const opts: Partial<DynamicToolManagerOptions> = {};
    const builder = {
      server(value: McpServer) { opts.server = value; return builder; },
      resolver(value: ModuleResolver) { opts.resolver = value; return builder; },
      context(value: unknown) { opts.context = value; return builder; },
      onToolsListChanged(value: () => Promise<void> | void) { opts.onToolsListChanged = value; return builder; },
      exposurePolicy(value: ExposurePolicy) { opts.exposurePolicy = value; return builder; },
      toolRegistry(value: ToolRegistry) { opts.toolRegistry = value; return builder; },
      build() { return new DynamicToolManager(opts as DynamicToolManagerOptions); },
    };
    return builder;
  }

  /**
   * @returns Promise that resolves when notification is sent (or skipped)
   */
  private async notifyToolsChanged(): Promise<void> {
    if (!this.onToolsListChanged) return;
    try {
      await this.onToolsListChanged();
    } catch (err) {
      console.warn("Failed to send tool list change notification:", err);
    }
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

  /**
   * Enables a single toolset by name.
   * @param toolsetName - The name of the toolset to enable
   * @param skipNotification - If true, skips the tool list change notification
   * @returns Result object with success status and message
   */
  public async enableToolset(
    toolsetName: string,
    skipNotification = false
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

    // Check exposure policies BEFORE resolving tools to fail fast
    const policyCheck = this.checkExposurePolicy(sanitized);
    if (!policyCheck.allowed) {
      return { success: false, message: policyCheck.message };
    }

    // Track tools registered for this enable operation to allow rollback
    const registeredTools: string[] = [];

    try {
      const resolvedTools = await this.resolver.resolveToolsForToolsets(
        [sanitized],
        this.context
      );

      // Register all resolved tools (direct + module-derived)
      if (resolvedTools && resolvedTools.length > 0) {
        const mapped = this.toolRegistry.mapAndValidate(
          sanitized,
          resolvedTools
        );
        for (const tool of mapped) {
          this.registerSingleTool(tool, sanitized);
          registeredTools.push(tool.name);
        }
      }

      // Track state only after successful registration
      this.activeToolsets.add(sanitized);

      // Notify list change (unless skipped for batch operations)
      if (!skipNotification) {
        await this.notifyToolsChanged();
      }

      return {
        success: true,
        message: `Toolset '${sanitized}' enabled successfully. Registered ${
          resolvedTools?.length ?? 0
        } tools.`,
      };
    } catch (error) {
      // Note: We cannot unregister tools from MCP server, but we can track the inconsistency
      if (registeredTools.length > 0) {
        console.warn(
          `Partial failure enabling toolset '${sanitized}'. ` +
            `${registeredTools.length} tools were registered but toolset activation failed. ` +
            `Tools remain registered due to MCP limitations: ${registeredTools.join(", ")}`
        );
      }
      // Don't add to activeToolsets since we failed
      return {
        success: false,
        message: `Failed to enable toolset '${sanitized}': ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * @param toolsetName - The sanitized toolset name to check
   * @returns Object indicating if allowed and reason message if not
   */
  private checkExposurePolicy(toolsetName: string): {
    allowed: boolean;
    message: string;
  } {
    if (
      this.exposurePolicy?.allowlist &&
      !this.exposurePolicy.allowlist.includes(toolsetName)
    ) {
      return {
        allowed: false,
        message: `Toolset '${toolsetName}' is not allowed by policy.`,
      };
    }
    if (
      this.exposurePolicy?.denylist &&
      this.exposurePolicy.denylist.includes(toolsetName)
    ) {
      return {
        allowed: false,
        message: `Toolset '${toolsetName}' is denied by policy.`,
      };
    }
    if (this.exposurePolicy?.maxActiveToolsets !== undefined) {
      const next = this.activeToolsets.size + 1;
      if (next > this.exposurePolicy.maxActiveToolsets) {
        this.exposurePolicy.onLimitExceeded?.(
          [toolsetName],
          Array.from(this.activeToolsets)
        );
        return {
          allowed: false,
          message: `Activation exceeds maxActiveToolsets (${this.exposurePolicy.maxActiveToolsets}).`,
        };
      }
    }
    return { allowed: true, message: "" };
  }

  /**
   * @param tool - The tool definition to register
   * @param toolsetKey - The toolset key for tracking
   */
  private registerSingleTool(tool: McpToolDefinition, toolsetKey: string): void {
    // Only pass annotations if they exist and are not empty
    const hasAnnotations =
      tool.annotations && Object.keys(tool.annotations).length > 0;

    if (hasAnnotations && tool.annotations) {
      this.server.tool(
        tool.name,
        tool.description,
        tool.inputSchema as Parameters<typeof this.server.tool>[2],
        tool.annotations,
        async (args: Record<string, unknown>) => {
          return await tool.handler(args);
        }
      );
    } else {
      // Legacy 4-parameter call when no annotations
      this.server.tool(
        tool.name,
        tool.description,
        tool.inputSchema as Parameters<typeof this.server.tool>[2],
        async (args: Record<string, unknown>) => {
          return await tool.handler(args);
        }
      );
    }
    this.toolRegistry.addForToolset(toolsetKey, tool.name);
  }

  /**
   * @param toolsetName - The name of the toolset to disable
   * @returns Result object with success status and message
   */
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

    await this.notifyToolsChanged();

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

  /**
   * @param toolsetNames - Array of toolset names to enable
   * @returns Result object with overall success status and individual results
   */
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

    // Enable each toolset, skipping individual notifications
    for (const name of toolsetNames) {
      try {
        const res = await this.enableToolset(name, true);
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
    const anySuccess = results.some((r) => r.success);
    const message = successAll
      ? "All toolsets enabled"
      : anySuccess
        ? "Some toolsets failed to enable"
        : "All toolsets failed to enable";

    // Send a single notification after batch is complete (if any changes occurred)
    if (anySuccess) {
      await this.notifyToolsChanged();
    }

    return { success: successAll, results, message };
  }

  /**
   * @returns Result object with overall success status and individual results
   */
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
