import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ExposurePolicy, Mode, ToolSetCatalog } from "../types/index.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import {
  FastifyTransport,
  type FastifyTransportOptions,
} from "../http/FastifyTransport.js";

export interface CreateMcpServerOptions {
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, any>;
  exposurePolicy?: ExposurePolicy;
  context?: unknown;
  startup?: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" };
  registerMetaTools?: boolean;
  http?: FastifyTransportOptions;
  mcp?: {
    name?: string;
    version?: string;
    capabilities?: Record<string, unknown>;
  };
  configSchema?: object;
}

export async function createMcpServer(options: CreateMcpServerOptions) {
  const mode: Exclude<Mode, "ALL"> = options.startup?.mode ?? "DYNAMIC";
  const name = options.mcp?.name ?? "mcp-dynamic-tooling";
  const version = options.mcp?.version ?? "0.0.0";
  const baseCaps = options.mcp?.capabilities ?? {};
  const mergedCaps = {
    ...baseCaps,
    tools: {
      ...(typeof (baseCaps as any).tools === "object"
        ? (baseCaps as any).tools
        : {}),
      // listChanged is internal-only and computed by mode
      listChanged: mode === "DYNAMIC",
    },
  } as any;
  const server = new McpServer({
    name,
    version,
    capabilities: mergedCaps,
  });

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
    server,
    catalog: options.catalog,
    moduleLoaders: options.moduleLoaders,
    exposurePolicy: options.exposurePolicy,
    context: options.context,
    notifyToolsListChanged: async () => notifyToolsChanged(server),
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
      const innerMode: Exclude<Mode, "ALL"> =
        options.startup?.mode ?? "DYNAMIC";
      const innerName = options.mcp?.name ?? name;
      const innerVersion = options.mcp?.version ?? version;
      const innerBaseCaps = options.mcp?.capabilities ?? baseCaps;
      const innerMergedCaps = {
        ...innerBaseCaps,
        tools: {
          ...(typeof (innerBaseCaps as any).tools === "object"
            ? (innerBaseCaps as any).tools
            : {}),
          listChanged: innerMode === "DYNAMIC",
        },
      } as any;
      const server = new McpServer({
        name: innerName,
        version: innerVersion,
        capabilities: innerMergedCaps,
      });
      const orchestrator = new ServerOrchestrator({
        server,
        catalog: options.catalog,
        moduleLoaders: options.moduleLoaders,
        exposurePolicy: options.exposurePolicy,
        context: options.context,
        notifyToolsListChanged: async () => notifyToolsChanged(server),
        startup: options.startup,
        registerMetaTools:
          options.registerMetaTools !== undefined
            ? options.registerMetaTools
            : innerMode === "DYNAMIC",
      });
      return { server, orchestrator };
    },
    options.http,
    options.configSchema
  );

  return {
    server,
    start: async () => {
      await transport.start();
    },
    close: async () => {
      await transport.stop();
    },
  };
}
