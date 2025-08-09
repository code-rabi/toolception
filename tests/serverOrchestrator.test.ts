import { describe, it, expect } from "vitest";
import { ServerOrchestrator } from "../src/core/ServerOrchestrator.js";
import { createFakeMcpServer } from "./helpers/fakes.js";

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
  ext: {
    name: "Ext",
    description: "",
    tools: [
      {
        name: "echo",
        description: "",
        inputSchema: {},
        handler: async () => ({ ok: true }),
      },
    ],
  },
} as const;

describe("ServerOrchestrator", () => {
  it("registers meta-tools conditioned by mode", async () => {
    const dyn = createFakeMcpServer();
    new ServerOrchestrator({
      server: dyn.server,
      catalog: catalog as any,
      startup: { mode: "DYNAMIC" },
    });
    const dynamicToolNames = dyn.tools.map((t) => t.name);
    expect(dynamicToolNames).toContain("list_tools");
    expect(dynamicToolNames).toContain("list_toolsets");

    const stat = createFakeMcpServer();
    new ServerOrchestrator({
      server: stat.server,
      catalog: catalog as any,
      startup: { mode: "STATIC" },
    });
    const staticToolNames = stat.tools.map((t) => t.name);
    expect(staticToolNames).toContain("list_tools");
    expect(staticToolNames).not.toContain("list_toolsets");
  });

  it("preloads all toolsets in STATIC when configured and registers minimal meta-tools", async () => {
    const { server, tools } = createFakeMcpServer();
    new ServerOrchestrator({
      server,
      catalog: catalog as any,
      startup: { mode: "STATIC", toolsets: "ALL" },
    });
    // allow async enable to run
    await new Promise((r) => setTimeout(r, 0));
    const names = tools.map((t) => t.name);
    // Expect namespaced registrations for catalog tools
    expect(names).toContain("core.ping");
    expect(names).toContain("ext.echo");
    // Meta-tools: list_tools always available; list_toolsets not in static
    expect(names).toContain("list_tools");
    expect(names).not.toContain("list_toolsets");
    // Enable/disable are available in both modes
    expect(names).toContain("enable_toolset");
    expect(names).toContain("disable_toolset");
  });
});
