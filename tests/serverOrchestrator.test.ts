import { describe, it, expect, vi } from "vitest";
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
    // Meta-tools: list_tools always available in STATIC mode
    expect(names).toContain("list_tools");
    // Dynamic-only meta-tools should NOT be registered in STATIC mode
    expect(names).not.toContain("list_toolsets");
    expect(names).not.toContain("describe_toolset");
    expect(names).not.toContain("enable_toolset");
    expect(names).not.toContain("disable_toolset");
  });

  it("ignores toolsets in DYNAMIC mode with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { server, tools } = createFakeMcpServer();
    new ServerOrchestrator({
      server,
      catalog: catalog as any,
      startup: { mode: "DYNAMIC", toolsets: ["core", "ext"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("core.ping");
    expect(names).not.toContain("ext.echo");
    expect(warn).toHaveBeenCalledWith(
      "startup.toolsets provided but ignored in DYNAMIC mode"
    );
    warn.mockRestore();
  });

  it("throws in STATIC mode when toolsets are invalid/empty", async () => {
    expect(
      () =>
        new ServerOrchestrator({
          server: createFakeMcpServer().server,
          catalog: catalog as any,
          startup: { toolsets: ["nope"], mode: "STATIC" },
        })
    ).toThrow(/STATIC mode requires valid toolsets or 'ALL'; none were valid/);
  });
});
