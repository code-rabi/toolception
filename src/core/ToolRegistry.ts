import type { McpToolDefinition } from "../types/index.js";
import { ToolingError } from "../errors/ToolingError.js";
import type { ToolRegistryOptions } from "./core.types.js";

export class ToolRegistry {
  private readonly options: Required<ToolRegistryOptions>;
  private readonly names = new Set<string>();
  private readonly toolsetToNames = new Map<string, Set<string>>();

  constructor(options: ToolRegistryOptions = {}) {
    this.options = {
      namespaceWithToolset: options.namespaceWithToolset ?? true,
    };
  }

  static builder() {
    const opts: ToolRegistryOptions = {};
    const builder = {
      namespaceWithToolset(value: boolean) { opts.namespaceWithToolset = value; return builder; },
      build() { return new ToolRegistry(opts); },
    };
    return builder;
  }

  public getSafeName(toolsetKey: string, toolName: string): string {
    if (!this.options.namespaceWithToolset) return toolName;
    if (toolName.startsWith(`${toolsetKey}.`)) return toolName;
    return `${toolsetKey}.${toolName}`;
  }

  public has(name: string): boolean {
    return this.names.has(name);
  }

  public add(name: string): void {
    if (this.names.has(name)) {
      throw new ToolingError(
        `Tool name collision: '${name}' already registered`,
        "E_TOOL_NAME_CONFLICT"
      );
    }
    this.names.add(name);
  }

  public addForToolset(toolsetKey: string, name: string): void {
    this.add(name);
    const set = this.toolsetToNames.get(toolsetKey) ?? new Set<string>();
    set.add(name);
    this.toolsetToNames.set(toolsetKey, set);
  }

  public mapAndValidate(
    toolsetKey: string,
    tools: McpToolDefinition[]
  ): McpToolDefinition[] {
    return tools.map((t) => {
      const safe = this.getSafeName(toolsetKey, t.name);
      if (this.has(safe)) {
        throw new ToolingError(
          `Tool name collision for '${safe}'`,
          "E_TOOL_NAME_CONFLICT"
        );
      }
      return { ...t, name: safe };
    });
  }

  public list(): string[] {
    return Array.from(this.names);
  }

  public listByToolset(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [k, v] of this.toolsetToNames.entries()) {
      result[k] = Array.from(v);
    }
    return result;
  }
}
