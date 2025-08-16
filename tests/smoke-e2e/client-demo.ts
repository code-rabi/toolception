import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

async function main() {
  const PORT = Number(process.env.PORT ?? 3003);
  const url = `http://localhost:${PORT}/mcp`;
  const clientId = process.env.MCP_CLIENT_ID ?? "toolception-client-demo";

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { "mcp-client-id": clientId } },
  });

  const client = new Client({
    name: "toolception-client-demo",
    version: "0.1.0",
  });

  await client.connect(transport);

  console.log("Connected and initialized.");

  const listBefore = await client.listTools();
  console.log("tools before:", JSON.stringify(listBefore, null, 2));

  const toolNamesBefore = new Set<string>(
    (listBefore as any)?.tools?.map((t: any) => t.name) ?? []
  );
  if (!toolNamesBefore.has("core.ping")) {
    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "core" },
    } as any);
  }
  const ping = await client.callTool({
    name: "core.ping",
    arguments: {},
  } as any);
  console.log("core.ping:", JSON.stringify(ping, null, 2));
  const pingText = (ping as any)?.content?.[0]?.text ?? "";
  if (!String(pingText).toLowerCase().includes("pong")) {
    throw new Error(
      "Smoke check failed: core.ping did not return expected text"
    );
  }

  if (!toolNamesBefore.has("ext.echo")) {
    await client.callTool({
      name: "enable_toolset",
      arguments: { name: "ext" },
    } as any);
  }
  const echo = await client.callTool({
    name: "ext.echo",
    arguments: { text: "hello" },
  } as any);
  console.log("ext.echo:", JSON.stringify(echo, null, 2));
  const echoText = (echo as any)?.content?.[0]?.text ?? "";
  if (String(echoText) !== "hello") {
    throw new Error("Smoke check failed: ext.echo did not echo expected text");
  }

  const listAfter = await client.listTools();
  console.log("tools after:", JSON.stringify(listAfter, null, 2));

  await client.close();
  console.log("Smoke test OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
