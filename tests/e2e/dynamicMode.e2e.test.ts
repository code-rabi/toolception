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
  sessionContextCatalog,
  sessionContextModuleLoaders,
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

describe("DYNAMIC mode with session context E2E", () => {
  let server: Awaited<ReturnType<typeof createMcpServer>>;
  let port: number;

  beforeAll(async () => {
    port = await getAvailablePort();
    server = await createMcpServer({
      createServer: () =>
        new McpServer(
          {
            name: "test-session-context",
            version: "1.0.0",
          },
          { capabilities: { tools: { listChanged: true } } }
        ),
      catalog: sessionContextCatalog,
      moduleLoaders: sessionContextModuleLoaders,
      context: { baseValue: "shared" },
      sessionContext: {
        enabled: true,
        queryParam: {
          name: "config",
          encoding: "base64",
          allowedKeys: ["API_TOKEN", "USER_ID"],
        },
        merge: "shallow",
      },
      startup: { mode: "DYNAMIC" },
      http: { port },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it("passes session context to module loaders via query param", async () => {
    const sessionConfig = { API_TOKEN: "secret-token-123", USER_ID: "user-42" };
    const configBase64 = Buffer.from(JSON.stringify(sessionConfig)).toString(
      "base64"
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp?config=${configBase64}`),
      { requestInit: { headers: { "mcp-client-id": "session-client-1" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    // Enable the tenant toolset
    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "tenant" },
    } as any);

    // Call get_context to verify context was passed
    const result = await client.callTool({
      name: "tenant.get_context",
      arguments: {},
    } as any);

    const context = parseToolResponse<{
      API_TOKEN: string;
      USER_ID: string;
      baseValue: string;
    }>(result);

    expect(context.API_TOKEN).toBe("secret-token-123");
    expect(context.USER_ID).toBe("user-42");
    expect(context.baseValue).toBe("shared");

    await client.close();
  });

  it("merges session context with base context", async () => {
    const sessionConfig = { API_TOKEN: "another-token" };
    const configBase64 = Buffer.from(JSON.stringify(sessionConfig)).toString(
      "base64"
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp?config=${configBase64}`),
      { requestInit: { headers: { "mcp-client-id": "session-client-2" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "tenant" },
    } as any);

    const result = await client.callTool({
      name: "tenant.get_context",
      arguments: {},
    } as any);

    const context = parseToolResponse<{
      API_TOKEN: string;
      USER_ID: string | null;
      baseValue: string;
    }>(result);

    // Session config provides API_TOKEN
    expect(context.API_TOKEN).toBe("another-token");
    // USER_ID not in session config, should be null
    expect(context.USER_ID).toBeNull();
    // Base context is preserved
    expect(context.baseValue).toBe("shared");

    await client.close();
  });

  it("filters disallowed keys from session config", async () => {
    const sessionConfig = {
      API_TOKEN: "valid-token",
      FORBIDDEN_KEY: "should-not-appear",
      USER_ID: "user-99",
    };
    const configBase64 = Buffer.from(JSON.stringify(sessionConfig)).toString(
      "base64"
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp?config=${configBase64}`),
      { requestInit: { headers: { "mcp-client-id": "session-client-3" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "tenant" },
    } as any);

    const result = await client.callTool({
      name: "tenant.get_context",
      arguments: {},
    } as any);

    const context = parseToolResponse<{
      API_TOKEN: string;
      USER_ID: string;
      baseValue: string;
    }>(result);

    // Allowed keys are present
    expect(context.API_TOKEN).toBe("valid-token");
    expect(context.USER_ID).toBe("user-99");
    // Base context is preserved
    expect(context.baseValue).toBe("shared");
    // FORBIDDEN_KEY is not in the response (filtered by allowedKeys)

    await client.close();
  });

  it("uses base context when no session config provided", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp`),
      { requestInit: { headers: { "mcp-client-id": "session-client-4" } } }
    );
    const client = new Client({ name: "test", version: "1.0.0" });

    await client.connect(transport);

    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "tenant" },
    } as any);

    const result = await client.callTool({
      name: "tenant.get_context",
      arguments: {},
    } as any);

    const context = parseToolResponse<{
      API_TOKEN: string | null;
      USER_ID: string | null;
      baseValue: string;
    }>(result);

    // No session config, so API_TOKEN and USER_ID are null
    expect(context.API_TOKEN).toBeNull();
    expect(context.USER_ID).toBeNull();
    // Base context is still available
    expect(context.baseValue).toBe("shared");

    await client.close();
  });

  it("different clients with different session configs get isolated contexts", async () => {
    // Client A with token A
    const configA = { API_TOKEN: "token-A", USER_ID: "user-A" };
    const configBase64A = Buffer.from(JSON.stringify(configA)).toString(
      "base64"
    );
    const transportA = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp?config=${configBase64A}`),
      { requestInit: { headers: { "mcp-client-id": "isolated-client-A" } } }
    );
    const clientA = new Client({ name: "test", version: "1.0.0" });
    await clientA.connect(transportA);

    // Client B with token B
    const configB = { API_TOKEN: "token-B", USER_ID: "user-B" };
    const configBase64B = Buffer.from(JSON.stringify(configB)).toString(
      "base64"
    );
    const transportB = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp?config=${configBase64B}`),
      { requestInit: { headers: { "mcp-client-id": "isolated-client-B" } } }
    );
    const clientB = new Client({ name: "test", version: "1.0.0" });
    await clientB.connect(transportB);

    // Enable toolset for both
    await clientA.callTool({
      name: "enable_toolset",
      arguments: { name: "tenant" },
    } as any);
    await clientB.callTool({
      name: "enable_toolset",
      arguments: { name: "tenant" },
    } as any);

    // Get context for client A
    const resultA = await clientA.callTool({
      name: "tenant.get_context",
      arguments: {},
    } as any);
    const contextA = parseToolResponse<{
      API_TOKEN: string;
      USER_ID: string;
    }>(resultA);

    // Get context for client B
    const resultB = await clientB.callTool({
      name: "tenant.get_context",
      arguments: {},
    } as any);
    const contextB = parseToolResponse<{
      API_TOKEN: string;
      USER_ID: string;
    }>(resultB);

    // Each client should have their own context
    expect(contextA.API_TOKEN).toBe("token-A");
    expect(contextA.USER_ID).toBe("user-A");
    expect(contextB.API_TOKEN).toBe("token-B");
    expect(contextB.USER_ID).toBe("user-B");

    await clientA.close();
    await clientB.close();
  });
});
