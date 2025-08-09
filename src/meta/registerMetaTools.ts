import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mode } from "../types/index.js";
import { z } from "zod";
import { DynamicToolManager } from "../core/DynamicToolManager.js";

export function registerMetaTools(
  server: McpServer,
  manager: DynamicToolManager,
  options?: { mode?: Exclude<Mode, "ALL"> }
): void {
  const mode = options?.mode ?? "DYNAMIC";
  // list_tools is always available
  server.tool(
    "enable_toolset",
    "Enable a toolset by name",
    { name: z.string().describe("Toolset name") },
    async (args: any) => {
      const { name } = args as { name: string };
      const result = await manager.enableToolset(name);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      } as any;
    }
  );

  server.tool(
    "disable_toolset",
    "Disable a toolset by name (state only)",
    { name: z.string().describe("Toolset name") },
    async (args: any) => {
      const { name } = args as { name: string };
      const result = await manager.disableToolset(name);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      } as any;
    }
  );

  if (mode === "DYNAMIC") {
    server.tool(
      "list_toolsets",
      "List available toolsets with active status and definitions",
      {},
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
        } as any;
      }
    );

    server.tool(
      "describe_toolset",
      "Describe a toolset with definition, active status and tools",
      { name: z.string().describe("Toolset name") },
      async (args: any) => {
        const { name } = args as { name: string };
        const def = manager.getToolsetDefinition(name);
        const byToolset = manager.getStatus().toolsetToTools;
        if (!def) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Unknown toolset '${name}'` }),
              },
            ],
          } as any;
        }
        const payload = {
          key: name,
          active: manager.isActive(name),
          definition: {
            name: def.name,
            description: def.description,
            modules: def.modules ?? [],
            decisionCriteria: def.decisionCriteria ?? undefined,
          },
          tools: byToolset[name] ?? [],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
        } as any;
      }
    );
  }

  server.tool(
    "list_tools",
    "List currently registered tool names (best effort)",
    {},
    async () => {
      const status = manager.getStatus();
      const payload = {
        tools: status.tools,
        toolsetToTools: status.toolsetToTools,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
      } as any;
    }
  );
}
