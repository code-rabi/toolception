import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Smoke test client demonstrating header-based permission control.
 * 
 * This client tests that:
 * 1. Clients can access tools from permitted toolsets (via header)
 * 2. Clients are denied access to tools from non-permitted toolsets
 * 3. Different permission headers result in different tool access
 */

async function testWithPermissions(
  port: number,
  clientId: string,
  permissions: string[]
) {
  const url = `http://localhost:${port}/mcp`;
  const permissionHeader = permissions.join(",");

  console.log(`\n=== Testing client: ${clientId} ===`);
  console.log(`Permissions: ${permissionHeader || "(none)"}`);

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        "mcp-client-id": clientId,
        "mcp-toolset-permissions": permissionHeader,
      },
    },
  });

  const client = new Client({
    name: "toolception-permission-header-client",
    version: "0.1.0",
  });

  await client.connect(transport);
  console.log("Connected and initialized.");

  // List available tools (may fail if no tools are available)
  let toolNames = new Set<string>();
  try {
    const toolsList = await client.listTools();
    toolNames = new Set<string>(
      (toolsList as any)?.tools?.map((t: any) => t.name) ?? []
    );
    console.log(`Available tools: ${Array.from(toolNames).join(", ") || "(none)"}`);
  } catch (error) {
    // If listTools fails (e.g., no tools available), that's expected for empty permissions
    if (permissions.length === 0) {
      console.log("Available tools: (none) - listTools not available");
    } else {
      throw error;
    }
  }

  // Test accessing permitted tools
  for (const permission of permissions) {
    const expectedTool = `${permission}.`;
    const hasPermittedTool = Array.from(toolNames).some((name) =>
      name.startsWith(expectedTool)
    );
    if (!hasPermittedTool) {
      throw new Error(
        `Expected to have access to ${permission} toolset, but no tools found`
      );
    }
    console.log(`✓ Has access to ${permission} toolset`);
  }

  // Test specific tool calls for permitted toolsets
  if (permissions.includes("math")) {
    try {
      const result = await client.callTool({
        name: "math.add",
        arguments: { a: 5, b: 3 },
      } as any);
      const resultText = (result as any)?.content?.[0]?.text ?? "";
      if (resultText !== "8") {
        throw new Error(`math.add returned unexpected result: ${resultText}`);
      }
      console.log("✓ math.add(5, 3) = 8");
    } catch (error) {
      throw new Error(`Failed to call permitted tool math.add: ${error}`);
    }
  }

  if (permissions.includes("text")) {
    try {
      const result = await client.callTool({
        name: "text.uppercase",
        arguments: { text: "hello" },
      } as any);
      const resultText = (result as any)?.content?.[0]?.text ?? "";
      if (resultText !== "HELLO") {
        throw new Error(
          `text.uppercase returned unexpected result: ${resultText}`
        );
      }
      console.log("✓ text.uppercase('hello') = HELLO");
    } catch (error) {
      throw new Error(`Failed to call permitted tool text.uppercase: ${error}`);
    }
  }

  if (permissions.includes("data")) {
    try {
      const result = await client.callTool({
        name: "data.reverse",
        arguments: { text: "abc" },
      } as any);
      const resultText = (result as any)?.content?.[0]?.text ?? "";
      if (resultText !== "cba") {
        throw new Error(
          `data.reverse returned unexpected result: ${resultText}`
        );
      }
      console.log("✓ data.reverse('abc') = cba");
    } catch (error) {
      throw new Error(`Failed to call permitted tool data.reverse: ${error}`);
    }
  }

  // Test that non-permitted tools are not accessible
  const allToolsets = ["math", "text", "data"];
  const deniedToolsets = allToolsets.filter((ts) => !permissions.includes(ts));

  for (const denied of deniedToolsets) {
    const deniedTool = `${denied}.`;
    const hasDeniedTool = Array.from(toolNames).some((name) =>
      name.startsWith(deniedTool)
    );
    if (hasDeniedTool) {
      throw new Error(
        `Should NOT have access to ${denied} toolset, but tools were found`
      );
    }
    console.log(`✓ Correctly denied access to ${denied} toolset`);
  }

  await client.close();
  console.log(`✓ Client ${clientId} test passed`);
}

async function main() {
  const PORT = Number(process.env.PORT ?? 3004);

  // Test 1: Client with math and text permissions
  await testWithPermissions(PORT, "client-math-text", ["math", "text"]);

  // Test 2: Client with only data permissions
  await testWithPermissions(PORT, "client-data-only", ["data"]);

  // Test 3: Client with all permissions
  await testWithPermissions(PORT, "client-all", ["math", "text", "data"]);

  // Test 4: Client with no permissions (should connect but have no tools)
  console.log("\n=== Testing client: client-none ===");
  console.log("Permissions: (none)");
  const transport4 = new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`), {
    requestInit: {
      headers: {
        "mcp-client-id": "client-none",
        "mcp-toolset-permissions": "",
      },
    },
  });
  const client4 = new Client({
    name: "toolception-permission-header-client",
    version: "0.1.0",
  });
  await client4.connect(transport4);
  console.log("Connected and initialized.");
  
  // Should have no tools available
  try {
    const toolsList = await client4.listTools();
    const toolNames = (toolsList as any)?.tools?.map((t: any) => t.name) ?? [];
    if (toolNames.length > 0) {
      throw new Error(`Expected no tools but found: ${toolNames.join(", ")}`);
    }
    console.log("✓ Correctly has no tools available");
  } catch (error: any) {
    // listTools may not be available when no tools exist - this is acceptable
    if (error.code === -32601) {
      console.log("✓ Correctly has no tools available (listTools not registered)");
    } else {
      throw error;
    }
  }
  
  await client4.close();
  console.log("✓ Client client-none test passed");

  console.log("\n=== All smoke tests passed ===");
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:");
  console.error(err);
  process.exit(1);
});
