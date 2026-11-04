import {
  fromJsonSchema,
  type JsonSchemaType,
  type McpServer,
  type RegisteredTool,
  type StandardSchemaWithJSON,
  type jsonSchemaValidator,
} from "@modelcontextprotocol/server";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";
import { z } from "zod";
import type {
  ExposurePolicy,
  McpToolDefinition,
  ToolSetDefinition,
  ToolingErrorCode,
} from "../types/index.js";
import { ToolingError } from "../errors/ToolingError.js";
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
  /** SDK handles of each toolset's registered tools, used to unregister them. */
  private readonly toolHandles = new Map<string, readonly RegisteredTool[]>();
  /**
   * Validator for JSON Schema tools, created on first use. It is deliberately
   * per manager (so per client): the SDK's shared default validator caches
   * compiled schemas by `$id` and by object for the life of the process, which
   * would let one client's schema answer for another's and grow with every client.
   */
  private jsonSchemaValidator?: jsonSchemaValidator;

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
   * @returns Result object with success status and message; `code` is set only when enabling threw, normally while registering the toolset's tools
   */
  public async enableToolset(
    toolsetName: string,
    skipNotification = false
  ): Promise<{ success: boolean; message: string; code?: ToolingErrorCode }> {
    const validation = this.validateToolsetForEnable(toolsetName);
    if ("message" in validation) return validation;

    const { sanitized } = validation;

    // Check exposure policies BEFORE resolving tools to fail fast
    const policyCheck = this.checkExposurePolicy(sanitized);
    if (!policyCheck.allowed) {
      return { success: false, message: policyCheck.message };
    }

    try {
      const toolCount = await this.resolveAndRegisterTools(sanitized);

      // Track state only after successful registration
      this.activeToolsets.add(sanitized);

      // Notify list change (unless skipped for batch operations)
      if (!skipNotification) {
        await this.notifyToolsChanged();
      }

      return this.buildEnableResult(sanitized, toolCount);
    } catch (error) {
      this.removeToolsetTools(sanitized);
      return {
        success: false,
        message: `Failed to enable toolset '${sanitized}': ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        // Only this path sets a code; ServerOrchestrator treats it as "enabling threw"
        code: error instanceof ToolingError ? error.code : "E_INTERNAL",
      };
    }
  }

  /**
   * @param toolsetName - The raw toolset name to validate
   * @returns Error result if invalid, or `{ sanitized }` to continue
   */
  private validateToolsetForEnable(
    toolsetName: string
  ): { success: boolean; message: string } | { sanitized: string } {
    const validation = this.resolver.validateToolsetName(toolsetName);
    if (!validation.isValid || !validation.sanitized) {
      return {
        success: false,
        message: validation.error || "Unknown validation error",
      };
    }
    if (this.activeToolsets.has(validation.sanitized)) {
      return {
        success: false,
        message: `Toolset '${validation.sanitized}' is already enabled.`,
      };
    }
    return { sanitized: validation.sanitized };
  }

  /**
   * @param sanitized - The validated toolset name
   * @returns The number of tools resolved
   */
  private async resolveAndRegisterTools(sanitized: string): Promise<number> {
    const resolvedTools = await this.resolver.resolveToolsForToolsets(
      [sanitized],
      this.context
    );

    if (resolvedTools && resolvedTools.length > 0) {
      const mapped = this.toolRegistry.mapAndValidate(sanitized, resolvedTools);
      for (const tool of mapped) {
        this.registerSingleTool(tool, sanitized);
      }
    }

    return resolvedTools?.length ?? 0;
  }

  /**
   * @param sanitized - The toolset name
   * @param toolCount - Number of tools registered
   * @returns Success result object
   */
  private buildEnableResult(
    sanitized: string,
    toolCount: number
  ): { success: boolean; message: string } {
    return {
      success: true,
      message: `Toolset '${sanitized}' enabled successfully. Registered ${toolCount} tools.`,
    };
  }

  /**
   * Unregisters every tool of a toolset from the MCP server and the registry.
   * Also rolls back a partially failed enable, so no orphaned tools stay callable.
   *
   * @param toolsetKey - The toolset whose tools to remove
   * @returns The number of tools removed
   */
  private removeToolsetTools(toolsetKey: string): number {
    const handles = this.toolHandles.get(toolsetKey) ?? [];
    for (const handle of handles) {
      handle.remove();
    }
    this.toolHandles.delete(toolsetKey);
    this.toolRegistry.removeForToolset(toolsetKey);
    return handles.length;
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

    const inputSchema = toRegistrableInputSchema(
      tool.name,
      tool.inputSchema,
      () => (this.jsonSchemaValidator ??= new AjvJsonSchemaValidator())
    );

    const handle = this.server.registerTool(
      tool.name,
      {
        title: tool.annotations?.title,
        description: tool.description,
        inputSchema,
        annotations: hasAnnotations ? tool.annotations : undefined,
      },
      async (args: Record<string, unknown>) => {
        return await tool.handler(args);
      }
    );
    this.toolHandles.set(toolsetKey, [
      ...(this.toolHandles.get(toolsetKey) ?? []),
      handle,
    ]);
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

    const removedCount = this.removeToolsetTools(sanitized);
    this.activeToolsets.delete(sanitized);

    await this.notifyToolsChanged();

    return {
      success: true,
      message: `Toolset '${sanitized}' disabled successfully. Removed ${removedCount} tools.`,
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

/** The schema type handed to `registerTool`; arguments arrive as a plain record. */
type InputSchema = StandardSchemaWithJSON<
  Record<string, unknown>,
  Record<string, unknown>
>;

/**
 * @param value - Any value
 * @returns True when the value is a Zod 4 schema instance
 */
function isZod4Type(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value;
}

/**
 * @param value - Any value
 * @returns True when the value is a Zod 3 schema instance (has `_def` but not `_zod`)
 */
function isZod3Type(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "_def" in value &&
    !("_zod" in value)
  );
}

/**
 * Turns a tool's `inputSchema` into the schema that `McpServer.registerTool`
 * expects.
 *
 * - A Zod 4 schema instance is used as is.
 * - A raw shape of Zod 4 schemas (an empty object counts as an empty shape) is
 *   wrapped with toolception's own `z.object()`, so the SDK never wraps it with
 *   a second copy of Zod.
 * - A plain JSON Schema object (`type: "object"`) goes through the SDK's
 *   `fromJsonSchema()`: clients see its real properties and arguments are
 *   validated against it before the handler runs.
 * - A missing schema registers as an open object, so arguments still reach the handler.
 *
 * @param toolName - The tool name, used in error messages
 * @param schema - The tool's inputSchema
 * @param getValidator - Supplies the JSON Schema validator; called only for JSON Schema tools
 * @returns A schema to pass to `registerTool`
 * @throws ToolingError `E_VALIDATION` when the schema or a shape value is a Zod 3 schema,
 *   when the schema is neither a Zod 4 shape nor a JSON Schema object, or when the JSON
 *   Schema cannot be compiled (bad keyword, unresolved `$ref`, unsupported dialect)
 */
function toRegistrableInputSchema(
  toolName: string,
  schema: unknown,
  getValidator: () => jsonSchemaValidator
): InputSchema {
  if (typeof schema !== "object" || schema === null) {
    return z.looseObject({}) as InputSchema;
  }
  const values = isZod4Type(schema) || isZod3Type(schema)
    ? [schema]
    : Object.values(schema);
  if (values.some(isZod3Type)) {
    throw new ToolingError(
      `Tool '${toolName}' uses a Zod 3 schema. toolception requires Zod 4 (zod ^4.6.7): MCP SDK v2 cannot read Zod 3 schemas.`,
      "E_VALIDATION"
    );
  }
  // Casts: tool arguments reach the handler as `Record<string, unknown>`; the
  // SDK checks object-ness itself when it converts the schema for `tools/list`.
  if (isZod4Type(schema)) return schema as InputSchema;
  if (values.every(isZod4Type)) {
    return z.object(schema as Record<string, z.ZodType>) as InputSchema;
  }
  if ((schema as { type?: unknown }).type !== "object") {
    throw new ToolingError(
      `Tool '${toolName}' has an inputSchema that is neither a Zod 4 shape nor a JSON Schema object (type: "object").`,
      "E_VALIDATION"
    );
  }
  try {
    return fromJsonSchema<Record<string, unknown>>(
      schema as JsonSchemaType,
      getValidator()
    );
  } catch (error) {
    throw new ToolingError(
      `Tool '${toolName}' has an invalid JSON Schema inputSchema: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "E_VALIDATION"
    );
  }
}
