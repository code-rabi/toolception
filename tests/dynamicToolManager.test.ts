import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { DynamicToolManager } from "../src/core/DynamicToolManager.js";
import { ModuleResolver } from "../src/mode/ModuleResolver.js";
import { ToolRegistry } from "../src/core/ToolRegistry.js";
import { createFakeMcpServer } from "./helpers/fakes.js";

describe("DynamicToolManager", () => {
  const catalog = {
    core: {
      name: "Core",
      description: "",
      tools: [
        {
          name: "ping",
          description: "",
          inputSchema: {},
          handler: async () => ({ ok: true }),
        },
      ],
    },
    ext: { name: "Ext", description: "", modules: ["ext"] },
  } as any;

  it("enables toolset and registers tools with namespacing", async () => {
    const { server, tools } = createFakeMcpServer();
    const resolver = new ModuleResolver({
      catalog,
      moduleLoaders: {
        ext: async () => [
          {
            name: "echo",
            description: "",
            inputSchema: {},
            handler: async () => ({}),
          },
        ],
      },
    });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });
    const res = await manager.enableToolset("core");
    expect(res.success).toBe(true);
    expect(manager.isActive("core")).toBe(true);
    expect(tools.map((t) => t.name)).toEqual(["core.ping"]);
  });

  it("applies allow/deny policy and maxActiveToolsets", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({
      server,
      resolver,
      exposurePolicy: {
        allowlist: ["core"],
        denylist: ["ext"],
        maxActiveToolsets: 1,
      },
    });
    expect((await manager.enableToolset("ext")).success).toBe(false);
    expect((await manager.enableToolset("core")).success).toBe(true);
    expect((await manager.enableToolset("core")).success).toBe(false); // already active
    expect((await manager.enableToolset("ext")).success).toBe(false); // exceeds max
  });

  it("returns validation error for unknown toolset and handles resolver failure", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({ server, resolver });
    // Unknown toolset
    const bad = await manager.enableToolset("does-not-exist");
    expect(bad.success).toBe(false);
    expect(bad.message).toMatch(/not found|Invalid/);

    // Force resolver failure
    vi.spyOn(resolver, "resolveToolsForToolsets").mockRejectedValue(
      new Error("loader exploded")
    );
    const err = await manager.enableToolset("core");
    expect(err.success).toBe(false);
    expect(err.message).toMatch(/loader exploded/);
  });

  it("disableToolset validates input and warns when notify fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({
      server,
      resolver,
      // simulate notify failing
      onToolsListChanged: async () => {
        throw new Error("notify failed");
      },
    });

    // invalid disable
    const invalid = await manager.disableToolset("");
    expect(invalid.success).toBe(false);

    // not active
    const notActive = await manager.disableToolset("core");
    expect(notActive.success).toBe(false);

    // enable then disable, hitting notify warning path
    await manager.enableToolset("core");
    const res = await manager.disableToolset("core");
    expect(res.success).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "Failed to send tool list change notification:",
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it("disableToolset updates state and returns message", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({ server, resolver });
    await manager.enableToolset("core");
    const res = await manager.disableToolset("core");
    expect(res.success).toBe(true);
    expect(manager.isActive("core")).toBe(false);
  });

  it("enableAllToolsets aggregates results", async () => {
    const { server } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({ server, resolver });
    const res = await manager.enableAllToolsets();
    expect(res.results.length).toBe(2);
    expect(res.success).toBe(true);
  });

  it("registers tools with annotations when provided", async () => {
    const { server, tools } = createFakeMcpServer();
    const catalogWithAnnotations = {
      annotated: {
        name: "Annotated Tools",
        description: "Tools with annotations",
        tools: [
          {
            name: "read_data",
            description: "Read-only tool",
            inputSchema: {},
            handler: async () => ({ data: "test" }),
            annotations: {
              readOnlyHint: true,
              idempotentHint: true,
            },
          },
          {
            name: "delete_data",
            description: "Destructive tool",
            inputSchema: {},
            handler: async () => ({ deleted: true }),
            annotations: {
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          {
            name: "fetch_weather",
            description: "External API tool",
            inputSchema: {},
            handler: async () => ({ weather: "sunny" }),
            annotations: {
              readOnlyHint: true,
              openWorldHint: true,
              idempotentHint: false,
            },
          },
        ],
      },
    } as any;

    const resolver = new ModuleResolver({ catalog: catalogWithAnnotations });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });

    const res = await manager.enableToolset("annotated");
    expect(res.success).toBe(true);

    // Verify all tools were registered with correct annotations
    expect(tools.length).toBe(3);

    const readTool = tools.find((t) => t.name === "annotated.read_data");
    expect(readTool).toBeDefined();
    expect(readTool?.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
    });

    const deleteTool = tools.find((t) => t.name === "annotated.delete_data");
    expect(deleteTool).toBeDefined();
    expect(deleteTool?.annotations).toEqual({
      destructiveHint: true,
      idempotentHint: false,
    });

    const fetchTool = tools.find((t) => t.name === "annotated.fetch_weather");
    expect(fetchTool).toBeDefined();
    expect(fetchTool?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: false,
    });
  });

  it("registers tools without annotations when not provided", async () => {
    const { server, tools } = createFakeMcpServer();
    const resolver = new ModuleResolver({ catalog });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });

    const res = await manager.enableToolset("core");
    expect(res.success).toBe(true);

    const tool = tools.find((t) => t.name === "core.ping");
    expect(tool).toBeDefined();
    expect(tool?.annotations).toBeUndefined();
  });

  it("registers module-loaded tools with annotations", async () => {
    const { server, tools } = createFakeMcpServer();
    const catalogWithModules = {
      external: {
        name: "External",
        description: "External tools",
        modules: ["external"],
      },
    } as any;

    const resolver = new ModuleResolver({
      catalog: catalogWithModules,
      moduleLoaders: {
        external: async () => [
          {
            name: "api_call",
            description: "Call external API",
            inputSchema: {},
            handler: async () => ({ result: "ok" }),
            annotations: {
              openWorldHint: true,
              readOnlyHint: false,
              idempotentHint: false,
            },
          },
        ],
      },
    });

    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: true }),
    });

    const res = await manager.enableToolset("external");
    expect(res.success).toBe(true);

    const tool = tools.find((t) => t.name === "external.api_call");
    expect(tool).toBeDefined();
    expect(tool?.annotations).toEqual({
      openWorldHint: true,
      readOnlyHint: false,
      idempotentHint: false,
    });
  });
});

describe("DynamicToolManager with a real McpServer", () => {
  async function connect(tools: any[]) {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const resolver = new ModuleResolver({
      catalog: { core: { name: "Core", description: "", tools } } as any,
    });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: false }),
    });
    const result = await manager.enableToolset("core");
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "c", version: "1.0.0" });
    await client.connect(clientSide);
    return { result, client };
  }

  it("passes validated arguments from a Zod raw shape to the handler", async () => {
    const { result, client } = await connect([
      {
        name: "price",
        description: "Price",
        inputSchema: { symbol: z.string() },
        annotations: { title: "Price lookup", readOnlyHint: true },
        handler: async (args: { symbol: string }) => ({
          content: [{ type: "text", text: args.symbol }],
        }),
      },
    ]);
    expect(result.success).toBe(true);

    const { tools } = await client.listTools();
    expect(tools[0].title).toBe("Price lookup");
    expect(tools[0].inputSchema.properties).toHaveProperty("symbol");
    expect(tools[0].annotations?.readOnlyHint).toBe(true);

    const res = await client.callTool({ name: "price", arguments: { symbol: "AAPL" } });
    expect((res.content as any)[0].text).toBe("AAPL");
  });

  it("registers a plain JSON Schema inputSchema and hands valid arguments to the handler", async () => {
    const { result, client } = await connect([
      {
        name: "price",
        description: "Price",
        inputSchema: { type: "object", properties: { symbol: { type: "string" } } },
        handler: async (args: { symbol: string }) => ({
          content: [{ type: "text", text: args.symbol }],
        }),
      },
    ]);
    expect(result.success).toBe(true);

    const res = await client.callTool({ name: "price", arguments: { symbol: "MSFT" } });
    expect((res.content as any)[0].text).toBe("MSFT");
  });
});

describe("DynamicToolManager input schema handling (Zod 4)", () => {
  async function enable(inputSchema: unknown, precedingTools: unknown[] = []) {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const resolver = new ModuleResolver({
      catalog: {
        core: {
          name: "Core",
          description: "",
          tools: [
            ...precedingTools,
            {
              name: "echo",
              description: "Echo",
              inputSchema,
              handler: async (args: { text?: string }) => ({
                content: [{ type: "text", text: args.text ?? "none" }],
              }),
            },
          ],
        },
      } as any,
    });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: false }),
    });
    const result = await manager.enableToolset("core");
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "c", version: "1.0.0" });
    await client.connect(clientSide);
    return { result, client };
  }

  it("uses a Zod 4 object schema instance as is", async () => {
    const { result, client } = await enable(z.object({ text: z.string() }));
    expect(result.success).toBe(true);
    const { tools } = await client.listTools();
    expect(tools[0].inputSchema.properties).toHaveProperty("text");
    const res = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    expect((res.content as any)[0].text).toBe("hi");
  });

  it("validates arguments against a Zod 4 raw shape", async () => {
    const { client } = await enable({ text: z.string() });
    const res = await client.callTool({ name: "echo", arguments: { text: 42 } });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(/invalid|validation/i);
  });

  it("registers an empty shape as a tool without arguments", async () => {
    const { result, client } = await enable({});
    expect(result.success).toBe(true);
    const res = await client.callTool({ name: "echo", arguments: {} });
    expect((res.content as any)[0].text).toBe("none");
  });

  it("refuses a Zod 3 schema with a clear error, and rolls back the toolset's earlier tools", async () => {
    // A Zod 3 type has `_def` but no `_zod`.
    const zod3Like = { _def: { typeName: "ZodString" }, parse: () => "" };
    const first = {
      name: "first",
      description: "Registers before the bad tool",
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    };
    const { result, client } = await enable({ text: zod3Like }, [first]);
    expect(result.success).toBe(false);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toMatch(/Tool 'echo' uses a Zod 3 schema.*Zod 4/);
    expect((await client.listTools()).tools).toEqual([]);
  });

  it("refuses a Zod 3 schema instance as the whole inputSchema", async () => {
    const { result } = await enable({ _def: { typeName: "ZodObject" } });
    expect(result.success).toBe(false);
    expect(result.code).toBe("E_VALIDATION");
  });
});

describe("DynamicToolManager JSON Schema inputSchema", () => {
  const symbolSchema = {
    type: "object",
    properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1 } },
    required: ["symbol"],
    additionalProperties: false,
  };

  function managerFor(inputSchema: unknown, handler = vi.fn(async (args: any) => ({
    content: [{ type: "text", text: String(args.symbol ?? "none") }],
  }))) {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const resolver = new ModuleResolver({
      catalog: {
        core: {
          name: "Core",
          description: "",
          tools: [{ name: "price", description: "Price", inputSchema, handler }],
        },
      } as any,
    });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: false }),
    });
    return { server, manager, handler };
  }

  async function connectClient(server: McpServer) {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "c", version: "1.0.0" });
    await client.connect(clientSide);
    return client;
  }

  it("advertises the declared properties and required list", async () => {
    const { server, manager } = managerFor(symbolSchema);
    expect((await manager.enableToolset("core")).success).toBe(true);
    const client = await connectClient(server);
    const { tools } = await client.listTools();
    expect(tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1 } },
      required: ["symbol"],
      additionalProperties: false,
    });
  });

  it.each([
    ["a missing required property", {}, /required property 'symbol'/],
    ["a wrong type", { symbol: 42 }, /symbol must be string/],
    ["a violated constraint", { symbol: "AAPL", limit: 0 }, /limit must be >= 1/],
    ["an extra property the schema forbids", { symbol: "AAPL", extra: true }, /additional properties/],
  ])("rejects %s without calling the handler", async (_label, args, detail) => {
    const { server, manager, handler } = managerFor(symbolSchema);
    await manager.enableToolset("core");
    const client = await connectClient(server);
    const res = await client.callTool({ name: "price", arguments: args });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(detail);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes valid arguments through unchanged", async () => {
    const { server, manager, handler } = managerFor(symbolSchema);
    await manager.enableToolset("core");
    const client = await connectClient(server);
    const res = await client.callTool({
      name: "price",
      arguments: { symbol: "AAPL", limit: 3 },
    });
    expect(res.isError).toBeFalsy();
    expect(handler).toHaveBeenCalledWith({ symbol: "AAPL", limit: 3 });
  });

  it("registers a tool without an inputSchema as an open object", async () => {
    const { server, manager } = managerFor(undefined);
    expect((await manager.enableToolset("core")).success).toBe(true);
    const client = await connectClient(server);
    const res = await client.callTool({ name: "price", arguments: { symbol: "X" } });
    expect((res.content as any)[0].text).toBe("X");
  });

  it.each([
    ["an unknown type name", { type: "object", properties: { a: { type: "strng" } } }],
    ["an unresolved $ref", { type: "object", properties: { a: { $ref: "#/$defs/missing" } } }],
    ["an unsupported $schema dialect", { $schema: "http://example.com/other", type: "object" }],
  ])("fails the enable with E_VALIDATION on %s, and registers nothing", async (_label, schema) => {
    const { server, manager } = managerFor(schema);
    const result = await manager.enableToolset("core");
    expect(result.success).toBe(false);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toMatch(/Tool 'price' has an invalid JSON Schema inputSchema/);
    expect(manager.isActive("core")).toBe(false);
    const client = await connectClient(server);
    expect((await client.listTools()).tools).toEqual([]);
  });

  it.each([
    ["a JSON Schema whose root is not an object", { type: "string" }],
    ["a JSON Schema without a root type", { properties: { a: { type: "string" } } }],
    ["a shape that mixes Zod and non-Zod values", { a: z.string(), b: 5 }],
  ])("fails the enable with E_VALIDATION on %s", async (_label, schema) => {
    const { manager } = managerFor(schema);
    const result = await manager.enableToolset("core");
    expect(result.success).toBe(false);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toMatch(/neither a Zod 4 shape nor a JSON Schema object/);
  });

  it("validates each manager's client against its own schema, even for identical nested $id values", async () => {
    const schemaFor = (type: "string" | "number") => ({
      type: "object",
      properties: { value: { $ref: "#/$defs/value" } },
      required: ["value"],
      $defs: { value: { $id: "https://example.com/value", type } },
    });
    const a = managerFor(schemaFor("string"));
    const b = managerFor(schemaFor("number"));
    expect((await a.manager.enableToolset("core")).success).toBe(true);
    expect((await b.manager.enableToolset("core")).success).toBe(true);
    const clientA = await connectClient(a.server);
    const clientB = await connectClient(b.server);

    const aString = await clientA.callTool({ name: "price", arguments: { value: "x" } });
    const aNumber = await clientA.callTool({ name: "price", arguments: { value: 1 } });
    const bString = await clientB.callTool({ name: "price", arguments: { value: "x" } });
    const bNumber = await clientB.callTool({ name: "price", arguments: { value: 1 } });

    expect(aString.isError).toBeFalsy();
    expect(aNumber.isError).toBe(true);
    expect(bString.isError).toBe(true);
    expect(bNumber.isError).toBeFalsy();
  });

  it("validates two tools of one manager against their own schema when both declare the same root $id", async () => {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const echo = (args: any) => ({ content: [{ type: "text", text: String(args.value) }] });
    const schemaFor = (type: "string" | "number") => ({
      $id: "https://example.com/args",
      type: "object",
      properties: { value: { type } },
      required: ["value"],
    });
    const resolver = new ModuleResolver({
      catalog: {
        core: {
          name: "Core",
          description: "",
          tools: [
            { name: "text", description: "Text", inputSchema: schemaFor("string"), handler: echo },
            { name: "count", description: "Count", inputSchema: schemaFor("number"), handler: echo },
          ],
        },
      } as any,
    });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: false }),
    });
    expect((await manager.enableToolset("core")).success).toBe(true);
    const client = await connectClient(server);

    expect((await client.callTool({ name: "text", arguments: { value: "x" } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "text", arguments: { value: 1 } })).isError).toBe(true);
    expect((await client.callTool({ name: "count", arguments: { value: 1 } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "count", arguments: { value: "x" } })).isError).toBe(true);
    // The root $id is neither used nor advertised.
    const { tools } = await client.listTools();
    expect(tools.every((t) => !("$id" in t.inputSchema))).toBe(true);
  });

  it("rolls back the tools registered before a bad JSON Schema tool", async () => {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const resolver = new ModuleResolver({
      catalog: {
        core: {
          name: "Core",
          description: "",
          tools: [
            { name: "good", description: "Good", inputSchema: symbolSchema, handler: async () => ({ content: [] }) },
            {
              name: "bad",
              description: "Bad",
              inputSchema: { type: "object", properties: { a: { type: "strng" } } },
              handler: async () => ({ content: [] }),
            },
          ],
        },
      } as any,
    });
    const manager = new DynamicToolManager({
      server,
      resolver,
      toolRegistry: new ToolRegistry({ namespaceWithToolset: false }),
    });
    const result = await manager.enableToolset("core");
    expect(result.success).toBe(false);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toMatch(/Tool 'bad'/);
    expect(manager.isActive("core")).toBe(false);
    const client = await connectClient(server);
    expect((await client.listTools()).tools).toEqual([]);
  });

  it("re-enables a JSON Schema toolset with a $id after disabling it", async () => {
    const { server, manager } = managerFor({ ...symbolSchema, $id: "https://example.com/symbol" });
    expect((await manager.enableToolset("core")).success).toBe(true);
    expect((await manager.disableToolset("core")).success).toBe(true);
    expect((await manager.enableToolset("core")).success).toBe(true);
    const client = await connectClient(server);
    const res = await client.callTool({ name: "price", arguments: { symbol: "AAPL" } });
    expect(res.isError).toBeFalsy();
  });
});

describe("DynamicToolManager disable removes tools", () => {
  const ping = {
    name: "ping",
    description: "Ping",
    inputSchema: {},
    handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
  };

  // The SDK can't add the tools capability after connect, so, like the meta-tools
  // do in a real server, register one tool before connecting.
  function createServer() {
    const server = new McpServer(
      { name: "t", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } }
    );
    server.registerTool("meta", { inputSchema: z.object({}) }, async () => ({ content: [] }));
    return server;
  }

  async function connectManager(catalog: Record<string, unknown>) {
    const server = createServer();
    const resolver = new ModuleResolver({ catalog } as any);
    const manager = new DynamicToolManager({ server, resolver });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "c", version: "1.0.0" });
    await client.connect(clientSide);
    return { manager, client };
  }

  async function listedNames(client: Client) {
    return (await client.listTools()).tools.map((t) => t.name);
  }

  it("makes a disabled toolset's tools unlisted and uncallable", async () => {
    const { manager, client } = await connectManager({
      core: { name: "Core", description: "", tools: [ping] },
    });
    await manager.enableToolset("core");
    expect(await listedNames(client)).toEqual(["meta", "core.ping"]);

    const res = await manager.disableToolset("core");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Removed 1 tools");
    expect(await listedNames(client)).toEqual(["meta"]);

    // SDK v2 answers an unknown tool with a JSON-RPC error, not an `isError` result
    await expect(
      client.callTool({ name: "core.ping", arguments: {} })
    ).rejects.toThrow(/not found/i);
  });

  it("frees the tool names so the toolset can be enabled again", async () => {
    const { manager, client } = await connectManager({
      core: { name: "Core", description: "", tools: [ping] },
    });
    await manager.enableToolset("core");
    await manager.disableToolset("core");
    expect(manager.getStatus().tools).toEqual([]);
    expect(manager.getStatus().toolsetToTools).toEqual({});

    const again = await manager.enableToolset("core");
    expect(again.success).toBe(true);
    const res = await client.callTool({ name: "core.ping", arguments: {} });
    expect((res.content as any)[0].text).toBe("pong");
  });

  it("removes only the disabled toolset's tools", async () => {
    const { manager, client } = await connectManager({
      a: { name: "A", description: "", tools: [ping] },
      b: { name: "B", description: "", tools: [ping] },
    });

    await manager.enableToolsets(["a", "b"]);
    await manager.disableToolset("a");
    expect(await listedNames(client)).toEqual(["meta", "b.ping"]);
    expect(manager.getActiveToolsets()).toEqual(["b"]);
  });

  it("rolls back already registered tools when enabling fails part-way", async () => {
    // The second tool has the same name, so the SDK rejects its registration.
    const tools = [ping, ping];
    const { manager, client } = await connectManager({
      core: { name: "Core", description: "", tools },
    });
    const res = await manager.enableToolset("core");
    expect(res.success).toBe(false);
    expect(manager.isActive("core")).toBe(false);
    expect(await listedNames(client)).toEqual(["meta"]);
    expect(manager.getStatus().tools).toEqual([]);

    // The rolled-back names are free again once the toolset is fixed.
    tools.pop();
    expect((await manager.enableToolset("core")).success).toBe(true);
    expect(await listedNames(client)).toEqual(["meta", "core.ping"]);
  });
});
