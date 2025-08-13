import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ExposurePolicy, Mode, ToolSetCatalog } from "../types/index.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import {
  FastifyTransport,
  type FastifyTransportOptions,
} from "../http/FastifyTransport.js";
import { McpServerOptionsValidator } from "./validateOptions.js";

export interface CreateMcpServerOptions {
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, any>;
  exposurePolicy?: ExposurePolicy;
  context?: unknown;
  startup?: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" };
  registerMetaTools?: boolean;
  http?: FastifyTransportOptions;
  /**
   * Provide an existing MCP server instance. If omitted, you must provide createServer.
   * When provided together with createServer, this is used for the default (non-cached) manager,
   * while createServer is used for per-client bundles.
   */
  server?: McpServer;
  /**
   * Factory to create a fresh MCP server instance for each client bundle.
   * If omitted, the provided `server` instance will be reused for all clients.
   */
  createServer?: () => McpServer;
  configSchema?: object;
}

export async function createMcpServer(options: CreateMcpServerOptions) {
  const mode: Exclude<Mode, "ALL"> = options.startup?.mode ?? "DYNAMIC";
  McpServerOptionsValidator.validate(options);
  const baseServer: McpServer = options.server ?? options.createServer!();

  // Typed, guarded notifier
  type NotifierA = {
    server: { notification: (msg: { method: string }) => Promise<void> | void };
  };
  type NotifierB = { notifyToolsListChanged: () => Promise<void> | void };
  const hasNotifierA = (s: unknown): s is NotifierA =>
    typeof (s as any)?.server?.notification === "function";
  const hasNotifierB = (s: unknown): s is NotifierB =>
    typeof (s as any)?.notifyToolsListChanged === "function";
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
    } catch {}
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
      // Create a fresh server + orchestrator bundle for a new client when needed
      const createdServer: McpServer = options.createServer
        ? options.createServer()
        : baseServer;
      const orchestrator = new ServerOrchestrator({
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
      return { server: createdServer, orchestrator };
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
