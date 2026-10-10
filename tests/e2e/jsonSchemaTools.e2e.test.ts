import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createMcpServer } from "../../src/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getAvailablePort, extractTextContent } from "./helpers.js";

describe("JSON Schema tool definitions E2E", () => {
  let server: Awaited<ReturnType<typeof createMcpServer>>;
  let port: number;

  beforeAll(async () => {
    port = await getAvailablePort();
    server = await createMcpServer({
      createServer: () => new McpServer({ name: "test-json-schema", version: "1.0.0" }),
      catalog: {
        quotes: {
          name: "Quotes",
          description: "Quote tools",
          tools: [
            {
              name: "price",
              description: "Echoes the symbol",
              inputSchema: {
                type: "object",
                properties: { symbol: { type: "string" } },
                required: ["symbol"],
              },
              annotations: { readOnlyHint: true },
              handler: async ({ symbol }: { symbol: string }) => ({
                content: [{ type: "text", text: `${symbol}: 123.45` }],
              }),
            },
          ],
        },
      },
      startup: { mode: "STATIC", toolsets: ["quotes"] },
      http: { port },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it("registers the tool and passes arguments to the handler", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "json-schema-client" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    const price = tools.tools.find((t) => t.name === "quotes.price");
    expect(price).toBeDefined();
    expect(price?.annotations).toEqual({ readOnlyHint: true });

    const result = await client.callTool({
      name: "quotes.price",
      arguments: { symbol: "AAPL" },
    });
    expect(extractTextContent(result)).toBe("AAPL: 123.45");

    await client.close();
  });
});
