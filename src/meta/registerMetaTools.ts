import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mode } from "../types/index.js";
import { z } from "zod";
import { DynamicToolManager } from "../core/DynamicToolManager.js";

/**
 * Registers meta-tools on the MCP server for toolset management.
 *
 * In DYNAMIC mode, all meta-tools are registered:
 * - enable_toolset, disable_toolset: For runtime toolset management
 * - list_toolsets, describe_toolset: For toolset discovery
 * - list_tools: For listing registered tools
 *
 * In STATIC mode, only list_tools is registered since toolsets are fixed at startup.
 *
 * @param server - The MCP server to register tools on
 * @param manager - The DynamicToolManager instance
 * @param options - Configuration options including the mode
 */
export function registerMetaTools(
  server: McpServer,
  manager: DynamicToolManager,
  options?: { mode?: Exclude<Mode, "ALL"> }
): void {
  const mode = options?.mode ?? "DYNAMIC";

  // Dynamic-mode only tools: enable/disable toolsets at runtime
  if (mode === "DYNAMIC") {
    server.tool(
      "enable_toolset",
      "Enable a toolset by name",
      { name: z.string().describe("Toolset name") },
      { destructiveHint: true, idempotentHint: true },
      async (args: { name: string }) => {
        const result = await manager.enableToolset(args.name);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }
    );

    server.tool(
      "disable_toolset",
      "Disable a toolset by name (state only)",
      { name: z.string().describe("Toolset name") },
      { destructiveHint: true, idempotentHint: true },
      async (args: { name: string }) => {
        const result = await manager.disableToolset(args.name);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }
    );

    server.tool(
      "list_toolsets",
      "List available toolsets with active status and definitions",
      {},
      { readOnlyHint: true, idempotentHint: true },
      async () => {
        const available = manager.getAvailableToolsets();
        const byToolset = manager.getStatus().toolsetToTools;
        const items = available.map((key) => {
          const def = manager.getToolsetDefinition(key);
          return {
            key,
            active: manager.isActive(key),
            definition: def
              ? {
                  name: def.name,
                  description: def.description,
                  modules: def.modules ?? [],
                  decisionCriteria: def.decisionCriteria ?? undefined,
                }
              : null,
            tools: byToolset[key] ?? [],
          };
        });
        return {
          content: [
            { type: "text", text: JSON.stringify({ toolsets: items }) },
          ],
        };
      }
    );

    server.tool(
      "describe_toolset",
      "Describe a toolset with definition, active status and tools",
      { name: z.string().describe("Toolset name") },
      { readOnlyHint: true, idempotentHint: true },
      async (args: { name: string }) => {
        const def = manager.getToolsetDefinition(args.name);
        const byToolset = manager.getStatus().toolsetToTools;
        if (!def) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Unknown toolset '${args.name}'` }),
              },
            ],
          };
        }
        const payload = {
          key: args.name,
          active: manager.isActive(args.name),
          definition: {
            name: def.name,
            description: def.description,
            modules: def.modules ?? [],
            decisionCriteria: def.decisionCriteria ?? undefined,
          },
          tools: byToolset[args.name] ?? [],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
        };
      }
    );
  }

  // list_tools is available in both modes
  server.tool(
    "list_tools",
    "List currently registered tool names (best effort)",
    {},
    { readOnlyHint: true, idempotentHint: true },
    async () => {
      const status = manager.getStatus();
      const payload = {
        tools: status.tools,
        toolsetToTools: status.toolsetToTools,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
      };
    }
  );
}
