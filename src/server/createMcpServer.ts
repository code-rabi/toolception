import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ExposurePolicy,
  Mode,
  ModuleLoader,
  ToolSetCatalog,
} from "../types/index.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import {
  FastifyTransport,
  type FastifyTransportOptions,
} from "../http/FastifyTransport.js";

export interface CreateMcpServerOptions {
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, ModuleLoader>;
  exposurePolicy?: ExposurePolicy;
  context?: unknown;
  startup?: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" };
  registerMetaTools?: boolean;
  http?: FastifyTransportOptions;
  /**
   * Factory to create an MCP server instance. Required.
   * In DYNAMIC mode, a new instance is created per client bundle.
   * In STATIC mode, a single instance is created and reused across bundles.
   */
  createServer: () => McpServer;
  configSchema?: object;
}

export async function createMcpServer(options: CreateMcpServerOptions) {
  const mode: Exclude<Mode, "ALL"> = options.startup?.mode ?? "DYNAMIC";
  if (typeof options.createServer !== "function") {
    throw new Error("createMcpServer: `createServer` (factory) is required");
  }
  const baseServer: McpServer = options.createServer();

  // Typed, guarded notifier
  type NotifierA = {
    server: { notification: (msg: { method: string }) => Promise<void> | void };
  };
  type NotifierB = { notifyToolsListChanged: () => Promise<void> | void };
  const hasNotifierA = (s: unknown): s is NotifierA =>
    typeof (s as NotifierA)?.server?.notification === "function";
  const hasNotifierB = (s: unknown): s is NotifierB =>
    typeof (s as NotifierB)?.notifyToolsListChanged === "function";

  /**
   * Sends a tools list changed notification to the client.
   * Logs warnings on failure instead of throwing.
   * @param target - The MCP server instance
   */
  const notifyToolsChanged = async (target: unknown) => {
    try {
      if (hasNotifierA(target)) {
        await target.server.notification({
          method: "notifications/tools/list_changed",
        });
        return;
      }
      if (hasNotifierB(target)) {
        await target.notifyToolsListChanged();
      }
    } catch (err) {
      console.warn("Failed to send tools list changed notification:", err);
    }
  };

  const orchestrator = new ServerOrchestrator({
    server: baseServer,
    catalog: options.catalog,
    moduleLoaders: options.moduleLoaders,
    exposurePolicy: options.exposurePolicy,
    context: options.context,
    notifyToolsListChanged: async () => notifyToolsChanged(baseServer),
    startup: options.startup,
    registerMetaTools:
      options.registerMetaTools !== undefined
        ? options.registerMetaTools
        : mode === "DYNAMIC",
  });

  const transport = new FastifyTransport(
    orchestrator.getManager(),
    () => {
      // Create a server + orchestrator bundle
      // for a new client when needed
      if (mode === "STATIC") {
        // Reuse the base server and orchestrator to avoid duplicate registrations
        return { server: baseServer, orchestrator };
      }
      const createdServer: McpServer = options.createServer();
      const createdOrchestrator = new ServerOrchestrator({
        server: createdServer,
        catalog: options.catalog,
        moduleLoaders: options.moduleLoaders,
        exposurePolicy: options.exposurePolicy,
        context: options.context,
        notifyToolsListChanged: async () => notifyToolsChanged(createdServer),
        startup: options.startup,
        registerMetaTools:
          options.registerMetaTools !== undefined
            ? options.registerMetaTools
            : mode === "DYNAMIC",
      });
      return { server: createdServer, orchestrator: createdOrchestrator };
    },
    options.http,
    options.configSchema
  );

  return {
    server: baseServer,
    start: async () => {
      await transport.start();
    },
    close: async () => {
      await transport.stop();
    },
  };
}
