import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mode } from "../types/index.js";

export type CreateMcpServerValidationInput = {
  server?: McpServer;
  createServer?: () => McpServer;
  startup?: { mode?: Exclude<Mode, "ALL"> };
};

export class McpServerOptionsValidator {
  public static validate(input: CreateMcpServerValidationInput): void {
    const mode: Exclude<Mode, "ALL"> = input.startup?.mode ?? "DYNAMIC";

    if (!input.server && !input.createServer) {
      throw new Error(
        "createMcpServer: either `server` or `createServer` must be provided"
      );
    }

    if (input.server && input.createServer) {
      // eslint-disable-next-line no-console
      if (typeof process.emitWarning === "function") {
        process.emitWarning(
          "Both `server` and `createServer` were provided. The base instance will use `server`, and per-client bundles will use `createServer`.",
          { code: "TOOLCEPTION_CREATE_MCP_SERVER_BOTH" }
        );
      }
    }

    if (mode === "DYNAMIC" && !input.createServer) {
      throw new Error(
        "createMcpServer: in DYNAMIC mode `createServer` is required to create per-client server instances"
      );
    }
  }
}
