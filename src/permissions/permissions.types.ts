import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import type { CustomEndpointDefinition } from "../http/http.types.js";

export interface PermissionAwareFastifyTransportOptions {
  host?: string;
  port?: number;
  basePath?: string;
  cors?: boolean;
  logger?: boolean;
  app?: import("fastify").FastifyInstance;
  /**
   * Optional custom HTTP endpoints to register alongside MCP protocol endpoints.
   * Allows adding REST-like endpoints with Zod validation and type inference.
   * Handlers receive permission context (allowedToolsets, failedToolsets).
   */
  customEndpoints?: CustomEndpointDefinition[];
}

/**
 * Context information extracted from a client request.
 * Used to identify the client and resolve their permissions.
 */
export interface ClientRequestContext {
  /**
   * Unique identifier for the client making the request.
   * Must be provided via the mcp-client-id header for MCP protocol traffic.
   */
  clientId: string;

  /**
   * Request headers that may contain permission data.
   * Used for header-based permission resolution.
   */
  headers?: Record<string, string>;
}

/**
 * Result of permission-aware bundle creation, including the resolved permissions.
 */
export interface PermissionAwareBundle {
  /**
   * The MCP server instance for this client.
   */
  server: McpServer;

  /**
   * The orchestrator managing toolsets for this client.
   */
  orchestrator: ServerOrchestrator;

  /**
   * The resolved permissions (allowed toolsets) for this client.
   * Contains only the toolsets that were successfully enabled.
   */
  allowedToolsets: string[];

  /**
   * Toolsets that failed to enable (e.g., invalid names).
   * Empty if all requested toolsets were enabled successfully.
   */
  failedToolsets: string[];
}
