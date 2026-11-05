import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createMcpServer } from "../../src/index.js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { getAvailablePort, extractTextContent, extractToolNames, parseToolResponse } from "./helpers.js";

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
    expect(price?.inputSchema).toMatchObject({
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    });

    const result = await client.callTool({
      name: "quotes.price",
      arguments: { symbol: "AAPL" },
    });
    expect(extractTextContent(result)).toBe("AAPL: 123.45");

    await client.close();
  });

  it("rejects arguments that break the schema, for that call only", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "json-schema-invalid-client" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);

    const bad = await client.callTool({ name: "quotes.price", arguments: { symbol: 42 } });
    expect(bad.isError).toBe(true);
    expect(extractTextContent(bad)).toMatch(/Input validation error/);

    const good = await client.callTool({ name: "quotes.price", arguments: { symbol: "MSFT" } });
    expect(extractTextContent(good)).toBe("MSFT: 123.45");

    await client.close();
  });
});

describe("JSON Schema tools with concurrent clients E2E", () => {
  let server: Awaited<ReturnType<typeof createMcpServer>>;
  let port: number;
  /** Same root and nested `$id`, different types: each client is validated by its own toolset. */
  const schemaFor = (type: "string" | "number") => ({
    $id: "https://example.com/args",
    type: "object",
    properties: { value: { $ref: "#/$defs/value" } },
    required: ["value"],
    $defs: { value: { $id: "https://example.com/value", type } },
  });
  const echo = async ({ value }: { value: unknown }) => ({
    content: [{ type: "text" as const, text: String(value) }],
  });

  beforeAll(async () => {
    port = await getAvailablePort();
    server = await createMcpServer({
      createServer: () => new McpServer({ name: "test-json-schema-multi", version: "1.0.0" }),
      catalog: {
        texts: {
          name: "Texts",
          description: "String tools",
          tools: [{ name: "echo", description: "Echo", inputSchema: schemaFor("string"), handler: echo }],
        },
        numbers: {
          name: "Numbers",
          description: "Number tools",
          tools: [{ name: "echo", description: "Echo", inputSchema: schemaFor("number"), handler: echo }],
        },
      },
      startup: { mode: "DYNAMIC" },
      http: { port },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.close();
  });

  async function connect(clientId: string) {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
        requestInit: { headers: { "mcp-client-id": clientId } },
      })
    );
    return client;
  }

  const enable = async (client: Client, name: string) =>
    parseToolResponse<{ success: boolean }>(
      await client.callTool({ name: "enable_toolset", arguments: { name } } as any)
    );

  it("keeps each client's toolsets and validation apart", async () => {
    const a = await connect("json-schema-a");
    const b = await connect("json-schema-b");
    expect((await enable(a, "texts")).success).toBe(true);
    expect((await enable(b, "numbers")).success).toBe(true);

    expect(extractToolNames(await a.listTools())).toContain("texts.echo");
    expect(extractToolNames(await a.listTools())).not.toContain("numbers.echo");
    expect(extractToolNames(await b.listTools())).toContain("numbers.echo");
    expect(extractToolNames(await b.listTools())).not.toContain("texts.echo");

    expect(extractTextContent(await a.callTool({ name: "texts.echo", arguments: { value: "x" } }))).toBe("x");
    expect((await a.callTool({ name: "texts.echo", arguments: { value: 1 } })).isError).toBe(true);
    expect(extractTextContent(await b.callTool({ name: "numbers.echo", arguments: { value: 1 } }))).toBe("1");
    expect((await b.callTool({ name: "numbers.echo", arguments: { value: "x" } })).isError).toBe(true);

    // A disables its toolset; B keeps validating and serving its own.
    const disabled = parseToolResponse<{ success: boolean }>(
      await a.callTool({ name: "disable_toolset", arguments: { name: "texts" } } as any)
    );
    expect(disabled.success).toBe(true);
    expect(extractToolNames(await a.listTools())).not.toContain("texts.echo");
    expect(extractTextContent(await b.callTool({ name: "numbers.echo", arguments: { value: 2 } }))).toBe("2");

    await a.close();
    await b.close();
  });
});

