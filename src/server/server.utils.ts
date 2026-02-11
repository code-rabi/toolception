import { z } from "zod";
import type { Mode } from "../types/index.js";

/**
 * Zod schema for validating startup configuration.
 * Uses strict mode to reject unknown properties like 'initialToolsets'.
 */
export const startupConfigSchema = z
  .object({
    mode: z.enum(["DYNAMIC", "STATIC"]).optional(),
    toolsets: z.union([z.array(z.string()), z.literal("ALL")]).optional(),
  })
  .strict();

/**
 * Validates a startup configuration object against `startupConfigSchema`.
 * Throws a descriptive error when the config is invalid.
 *
 * @param startup - The startup configuration to validate
 */
export function validateStartupConfig(
  startup: { mode?: Exclude<Mode, "ALL">; toolsets?: string[] | "ALL" }
): void {
  try {
    startupConfigSchema.parse(startup);
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

/**
 * Creates a notifier function that sends `tools/list_changed` notifications
 * to an MCP server. Handles two different notification APIs and suppresses
 * "Not connected" errors that occur when no clients are connected.
 *
 * @returns A function that sends tools/list_changed notifications to an MCP server
 */
export function createToolsChangedNotifier(): (target: unknown) => Promise<void> {
  type NotifierA = {
    server: { notification: (msg: { method: string }) => Promise<void> | void };
  };
  type NotifierB = { notifyToolsListChanged: () => Promise<void> | void };

  const hasNotifierA = (s: unknown): s is NotifierA =>
    typeof (s as NotifierA)?.server?.notification === "function";
  const hasNotifierB = (s: unknown): s is NotifierB =>
    typeof (s as NotifierB)?.notifyToolsListChanged === "function";

  return async (target: unknown) => {
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
}

/**
 * Resolves whether meta-tools should be registered.
 * When `explicit` is provided it takes precedence; otherwise meta-tools are
 * enabled in DYNAMIC mode and disabled in STATIC mode.
 *
 * @param explicit - The user-provided registerMetaTools value (undefined = auto)
 * @param mode - The resolved server mode
 * @returns Whether meta-tools should be registered
 */
export function resolveMetaToolsFlag(
  explicit: boolean | undefined,
  mode: Exclude<Mode, "ALL">
): boolean {
  return explicit !== undefined ? explicit : mode === "DYNAMIC";
}
