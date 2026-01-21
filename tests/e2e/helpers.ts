import { createServer } from "net";
import type { ToolSetCatalog } from "../../src/types/index.js";

/**
 * Get an available port for the test server.
 * Uses a TCP server to find an available port, then closes it.
 */
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not get port")));
      }
    });
  });
}

/**
 * Common test catalog with core and admin toolsets.
 */
export const testCatalog: ToolSetCatalog = {
  core: {
    name: "Core",
    description: "Core utilities",
    tools: [
      {
        name: "ping",
        description: "Returns pong",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({
          content: [{ type: "text", text: "pong" }],
        }),
      },
    ],
  },
  admin: {
    name: "Admin",
    description: "Admin tools",
    tools: [
      {
        name: "reset",
        description: "Reset system",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({
          content: [{ type: "text", text: "reset done" }],
        }),
      },
    ],
  },
};

/**
 * Helper to extract tool names from MCP listTools response
 */
export function extractToolNames(listToolsResponse: any): string[] {
  return (listToolsResponse?.tools?.map((t: any) => t.name) ?? []) as string[];
}

/**
 * Helper to extract text content from MCP callTool response
 */
export function extractTextContent(callToolResponse: any): string {
  return (callToolResponse?.content?.[0]?.text ?? "") as string;
}

/**
 * Helper to parse JSON from MCP tool response
 */
export function parseToolResponse<T = any>(callToolResponse: any): T {
  const text = extractTextContent(callToolResponse);
  return JSON.parse(text) as T;
}
