import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createMcpServer } from "../../src/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getAvailablePort,
  testCatalog,
  extractToolNames,
  extractTextContent,
  parseToolResponse,
} from "./helpers.js";

describe("DYNAMIC mode E2E", () => {
  let server: Awaited<ReturnType<typeof createMcpServer>>;
  let port: number;

  beforeAll(async () => {
    port = await getAvailablePort();
    server = await createMcpServer({
      createServer: () =>
        new McpServer({
          name: "test-dynamic",
          version: "1.0.0",
        }, 
        { capabilities: { tools: { listChanged: true } }},
      ),
      catalog: testCatalog,
      startup: { mode: "DYNAMIC" },
      http: { port },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it("starts with only meta-tools available", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "test-client-1" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = extractToolNames(tools);

    // Should have meta-tools
    expect(toolNames).toContain("enable_toolset");
    expect(toolNames).toContain("disable_toolset");
    expect(toolNames).toContain("list_toolsets");
    expect(toolNames).toContain("describe_toolset");
    expect(toolNames).toContain("list_tools");

    // Should NOT have user tools yet
    expect(toolNames).not.toContain("core.ping");
    expect(toolNames).not.toContain("admin.reset");

    await client.close();
  });

  it("enables toolsets and makes tools available", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "test-client-2" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    // Enable core toolset
    const enableResult = await client.callTool({
      name: "enable_toolset",
      arguments: { name: "core" },
    } as any);

    const parsed = parseToolResponse<{ success: boolean; message: string }>(
      enableResult
    );
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain("enabled successfully");

    // Now core.ping should be available
    const tools = await client.listTools();
    const toolNames = extractToolNames(tools);
    expect(toolNames).toContain("core.ping");

    await client.close();
  });

  it("calls enabled tools successfully", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "test-client-3" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    // Enable and call
    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "core" },
    } as any);

    const pingResult = await client.callTool({
      name: "core.ping",
      arguments: {},
    } as any);

    expect(extractTextContent(pingResult)).toBe("pong");

    await client.close();
  });

  it("list_toolsets shows available and active status", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "test-client-4" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    // List before enabling
    const beforeResult = await client.callTool({
      name: "list_toolsets",
      arguments: {},
    } as any);

    const before = parseToolResponse<{ toolsets: any[] }>(beforeResult);
    expect(before.toolsets).toHaveLength(2);

    const coreBefore = before.toolsets.find((ts) => ts.key === "core");
    expect(coreBefore.active).toBe(false);

    // Enable core
    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "core" },
    } as any);

    // List after enabling
    const afterResult = await client.callTool({
      name: "list_toolsets",
      arguments: {},
    } as any);

    const after = parseToolResponse<{ toolsets: any[] }>(afterResult);
    const coreAfter = after.toolsets.find((ts) => ts.key === "core");
    expect(coreAfter.active).toBe(true);
    expect(coreAfter.tools).toContain("core.ping");

    await client.close();
  });

  it("disables toolsets", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "test-client-5" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    // Enable then disable
    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "core" },
    } as any);

    const disableResult = await client.callTool({
      name: "disable_toolset",
      arguments: { name: "core" },
    } as any);

    const parsed = parseToolResponse<{ success: boolean; message: string }>(
      disableResult
    );
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain("disabled");

    // Verify in list_toolsets
    const listResult = await client.callTool({
      name: "list_toolsets",
      arguments: {},
    } as any);

    const list = parseToolResponse<{ toolsets: any[] }>(listResult);
    const core = list.toolsets.find((ts) => ts.key === "core");
    expect(core.active).toBe(false);

    await client.close();
  });

  it("handles enable_toolset errors gracefully", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "test-client-6" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    // Try to enable non-existent toolset
    const result = await client.callTool({
      name: "enable_toolset",
      arguments: { name: "nonexistent" },
    } as any);

    const parsed = parseToolResponse<{ success: boolean; message: string }>(
      result
    );
    expect(parsed.success).toBe(false);
    expect(parsed.message).toBeDefined();

    await client.close();
  });

  it("describe_toolset returns toolset details", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "test-client-7" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    const result = await client.callTool({
      name: "describe_toolset",
      arguments: { name: "core" },
    } as any);

    const parsed = parseToolResponse<{
      key: string;
      active: boolean;
      definition: { name: string; description: string };
      tools: string[];
    }>(result);

    expect(parsed.key).toBe("core");
    expect(parsed.definition.name).toBe("Core");
    expect(parsed.definition.description).toBe("Core utilities");

    await client.close();
  });

  it("each client has independent toolset state", async () => {
    // Client 1 enables core
    const transport1 = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "independent-client-1" } } }
    );
    const client1 = new Client({ name: "test", version: "1.0.0" });
    await client1.connect(transport1);

    await client1.callTool({
      name: "enable_toolset",
      arguments: { name: "core" },
    } as any);

    // Client 2 should not have core enabled
    const transport2 = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "independent-client-2" } } }
    );
    const client2 = new Client({ name: "test", version: "1.0.0" });
    await client2.connect(transport2);

    const tools2 = await client2.listTools();
    const toolNames2 = extractToolNames(tools2);

    // Client 2 should NOT have core.ping (each client is independent)
    expect(toolNames2).not.toContain("core.ping");

    await client1.close();
    await client2.close();
  });
});
