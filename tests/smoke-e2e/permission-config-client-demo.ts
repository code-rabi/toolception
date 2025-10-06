import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Smoke test client demonstrating config-based permission control.
 * 
 * This client tests that:
 * 1. Known clients (in static map) receive their configured permissions
 * 2. Clients matching resolver patterns receive appropriate permissions
 * 3. Unknown clients receive default permissions
 * 4. Each client can only access their permitted toolsets
 */

async function testClient(
  port: number,
  clientId: string,
  expectedToolsets: string[]
) {
  const url = `http://localhost:${port}/mcp`;

  console.log(`\n=== Testing client: ${clientId} ===`);
  console.log(`Expected toolsets: ${expectedToolsets.join(", ") || "(none)"}`);

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        "mcp-client-id": clientId,
      },
    },
  });

  const client = new Client({
    name: "toolception-permission-config-client",
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
    if (expectedToolsets.length === 0) {
      console.log("Available tools: (none) - listTools not available");
    } else {
      throw error;
    }
  }

  // Verify expected toolsets are accessible
  for (const expectedToolset of expectedToolsets) {
    const expectedPrefix = `${expectedToolset}.`;
    const hasExpectedTool = Array.from(toolNames).some((name) =>
      name.startsWith(expectedPrefix)
    );
    if (!hasExpectedTool) {
      throw new Error(
        `Expected to have access to ${expectedToolset} toolset, but no tools found`
      );
    }
    console.log(`✓ Has access to ${expectedToolset} toolset`);
  }

  // Test specific tool calls for permitted toolsets
  if (expectedToolsets.includes("admin")) {
    try {
      const result = await client.callTool({
        name: "admin.reset",
        arguments: {},
      } as any);
      const resultText = (result as any)?.content?.[0]?.text ?? "";
      if (!resultText.includes("reset")) {
        throw new Error(`admin.reset returned unexpected result: ${resultText}`);
      }
      console.log("✓ admin.reset() succeeded");
    } catch (error) {
      throw new Error(`Failed to call permitted tool admin.reset: ${error}`);
    }
  }

  if (expectedToolsets.includes("user")) {
    try {
      const result = await client.callTool({
        name: "user.profile",
        arguments: { userId: "test-123" },
      } as any);
      const resultText = (result as any)?.content?.[0]?.text ?? "";
      if (!resultText.includes("test-123")) {
        throw new Error(
          `user.profile returned unexpected result: ${resultText}`
        );
      }
      console.log("✓ user.profile('test-123') succeeded");
    } catch (error) {
      throw new Error(`Failed to call permitted tool user.profile: ${error}`);
    }
  }

  if (expectedToolsets.includes("analytics")) {
    try {
      const result = await client.callTool({
        name: "analytics.report",
        arguments: { type: "monthly" },
      } as any);
      const resultText = (result as any)?.content?.[0]?.text ?? "";
      if (!resultText.includes("monthly")) {
        throw new Error(
          `analytics.report returned unexpected result: ${resultText}`
        );
      }
      console.log("✓ analytics.report('monthly') succeeded");
    } catch (error) {
      throw new Error(
        `Failed to call permitted tool analytics.report: ${error}`
      );
    }
  }

  // Verify non-permitted toolsets are not accessible
  const allToolsets = ["admin", "user", "analytics"];
  const deniedToolsets = allToolsets.filter(
    (ts) => !expectedToolsets.includes(ts)
  );

  for (const denied of deniedToolsets) {
    const deniedPrefix = `${denied}.`;
    const hasDeniedTool = Array.from(toolNames).some((name) =>
      name.startsWith(deniedPrefix)
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
  const PORT = Number(process.env.PORT ?? 3005);

  console.log("=== Testing Config-Based Permissions ===\n");

  // Test 1: Known client from static map - admin user
  console.log("Test 1: Static map - admin-user");
  await testClient(PORT, "admin-user", ["admin", "user", "analytics"]);

  // Test 2: Known client from static map - regular user
  console.log("\nTest 2: Static map - regular-user");
  await testClient(PORT, "regular-user", ["user"]);

  // Test 3: Known client from static map - analyst user
  console.log("\nTest 3: Static map - analyst-user");
  await testClient(PORT, "analyst-user", ["user", "analytics"]);

  // Test 4: Resolver function - admin pattern
  console.log("\nTest 4: Resolver function - admin-dynamic-123");
  await testClient(PORT, "admin-dynamic-123", ["admin", "user", "analytics"]);

  // Test 5: Resolver function - analyst pattern
  console.log("\nTest 5: Resolver function - analyst-dynamic-456");
  await testClient(PORT, "analyst-dynamic-456", ["user", "analytics"]);

  // Test 6: Resolver function - user pattern
  console.log("\nTest 6: Resolver function - user-dynamic-789");
  await testClient(PORT, "user-dynamic-789", ["user"]);

  // Test 7: Unknown client - should get default permissions
  console.log("\nTest 7: Unknown client - unknown-client-xyz");
  await testClient(PORT, "unknown-client-xyz", ["user"]); // default is ["user"]

  console.log("\n=== All smoke tests passed ===");
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:");
  console.error(err);
  process.exit(1);
});
