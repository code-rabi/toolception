import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mode } from "../types/index.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import {
  FastifyTransport,
} from "../http/FastifyTransport.js";
import { SessionContextResolver } from "../session/SessionContextResolver.js";
import { validateSessionContextConfig } from "../session/session.utils.js";
import { z } from "zod";
import type { CreateMcpServerOptions } from "./server.types.js";
import { startupConfigSchema } from "./server.utils.js";

export type { CreateMcpServerOptions } from "./server.types.js";

export async function createMcpServer(options: CreateMcpServerOptions) {
  // Validate startup configuration if provided
  if (options.startup) {
    try {
      startupConfigSchema.parse(options.startup);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formatted = error.format();
        throw new Error(
          `Invalid startup configuration:\n${JSON.stringify(formatted, null, 2)}\n\n` +
            `Hint: Common mistake - use "toolsets" not "initialToolsets"`
        );
      }
      throw error;
    }
  }

  const mode: Exclude<Mode, "ALL"> = options.startup?.mode ?? "DYNAMIC";

  // Validate session context configuration if provided
  let sessionContextResolver: SessionContextResolver | undefined;
  if (options.sessionContext) {
    validateSessionContextConfig(options.sessionContext);
    sessionContextResolver = SessionContextResolver.builder()
      .enabled(options.sessionContext.enabled ?? true)
      .queryParam(options.sessionContext.queryParam)
      .contextResolver(options.sessionContext.contextResolver)
      .merge(options.sessionContext.merge ?? "shallow")
      .build();

    // Warn if sessionContext is used with STATIC mode (limited effect)
    if (mode === "STATIC" && options.sessionContext.enabled !== false) {
      console.warn(
        "sessionContext has limited effect in STATIC mode: all clients share the same server instance with base context. " +
          "Use DYNAMIC mode for per-session context isolation."
      );
    }
  }
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
      // Suppress "Not connected" errors - expected when no clients are connected
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage === "Not connected") {
        return; // Silently ignore - no clients to notify
      }
      // Log other errors as they indicate actual problems
      console.warn("Failed to send tools list changed notification:", err);
    }
  };

  const orchestrator = ServerOrchestrator.builder()
    .server(baseServer)
    .catalog(options.catalog)
    .moduleLoaders(options.moduleLoaders ?? {})
    .exposurePolicy(options.exposurePolicy!)
    .context(options.context)
    .notifyToolsListChanged(async () => notifyToolsChanged(baseServer))
    .startup(options.startup!)
    .registerMetaTools(
      options.registerMetaTools !== undefined
        ? options.registerMetaTools
        : mode === "DYNAMIC"
    )
    .build();

  // In STATIC mode, wait for initialization to complete before starting
  if (mode === "STATIC") {
    await orchestrator.ensureReady();
  }

  const transport = new FastifyTransport(
    orchestrator.getManager(),
    (mergedContext?: unknown) => {
      // Create a server + orchestrator bundle
      // for a new client when needed
      // Use merged context if provided (from session context resolver),
      // otherwise fall back to base context
      const effectiveContext = mergedContext ?? options.context;

      if (mode === "STATIC") {
        // Reuse the base server and orchestrator to avoid duplicate registrations
        return { server: baseServer, orchestrator };
      }
      const createdServer: McpServer = options.createServer();
      const createdOrchestrator = ServerOrchestrator.builder()
        .server(createdServer)
        .catalog(options.catalog)
        .moduleLoaders(options.moduleLoaders ?? {})
        .exposurePolicy(options.exposurePolicy!)
        .context(effectiveContext)
        .notifyToolsListChanged(async () => notifyToolsChanged(createdServer))
        .startup(options.startup!)
        .registerMetaTools(
          options.registerMetaTools !== undefined
            ? options.registerMetaTools
            : mode === "DYNAMIC"
        )
        .build();
      return { server: createdServer, orchestrator: createdOrchestrator };
    },
    options.http,
    options.configSchema,
    sessionContextResolver,
    options.context
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
