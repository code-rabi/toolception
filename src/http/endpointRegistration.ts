import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  CustomEndpointDefinition,
  CustomEndpointRequest,
  EndpointErrorResponse,
} from "./customEndpoints.js";

/**
 * Options for registering custom endpoints
 */
export interface RegisterCustomEndpointsOptions {
  /**
   * Optional function to extract additional context for each request.
   * Used by permission-aware transport to inject permission data.
   */
  contextExtractor?: (
    req: FastifyRequest
  ) => Promise<Record<string, any>> | Record<string, any>;
}

/**
 * Registers custom endpoints on a Fastify instance.
 * Handles Zod validation, error responses, and type-safe request mapping.
 *
 * @param app - Fastify instance to register endpoints on
 * @param basePath - Base path for all endpoints (e.g., "/" or "/api")
 * @param endpoints - Array of custom endpoint definitions
 * @param options - Optional configuration for endpoint registration
 *
 * @example
 * ```typescript
 * registerCustomEndpoints(app, "/api", [
 *   defineEndpoint({
 *     method: "GET",
 *     path: "/users",
 *     querySchema: z.object({ limit: z.coerce.number() }),
 *     handler: async (req) => ({ users: [] }),
 *   }),
 * ]);
 * ```
 */
export function registerCustomEndpoints(
  app: FastifyInstance,
  basePath: string,
  endpoints: CustomEndpointDefinition[],
  options?: RegisterCustomEndpointsOptions
): void {
  // Built-in MCP paths that should not be overridden
  const reservedPaths = ["/mcp", "/healthz", "/tools", "/.well-known/mcp-config"];

  for (const endpoint of endpoints) {
    const fullPath = `${basePath}${endpoint.path}`;

    // Check for path conflicts with built-in endpoints
    const isReserved = reservedPaths.some((reserved) =>
      fullPath.startsWith(`${basePath}${reserved}`)
    );

    if (isReserved) {
      console.warn(
        `Custom endpoint ${endpoint.method} ${endpoint.path} conflicts with built-in MCP endpoint. Skipping registration.`
      );
      continue;
    }

    // Convert method to lowercase for Fastify
    const method = endpoint.method.toLowerCase() as
      | "get"
      | "post"
      | "put"
      | "delete"
      | "patch";

    // Register the endpoint with Fastify
    app[method](fullPath, async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        // Extract client ID from header or generate anonymous ID
        const clientIdHeader = (req.headers["mcp-client-id"] as string)?.trim();
        const clientId =
          clientIdHeader && clientIdHeader.length > 0
            ? clientIdHeader
            : `anon-${randomUUID()}`;

        // Validate request body if schema provided
        let body: any = undefined;
        if (endpoint.bodySchema) {
          const bodyResult = endpoint.bodySchema.safeParse(req.body);
          if (!bodyResult.success) {
            return createValidationError(reply, "body", bodyResult.error);
          }
          body = bodyResult.data;
        }

        // Validate query parameters if schema provided
        let query: any = {};
        if (endpoint.querySchema) {
          const queryResult = endpoint.querySchema.safeParse(req.query);
          if (!queryResult.success) {
            return createValidationError(reply, "query", queryResult.error);
          }
          query = queryResult.data;
        }

        // Validate path parameters if schema provided
        let params: any = {};
        if (endpoint.paramsSchema) {
          const paramsResult = endpoint.paramsSchema.safeParse(req.params);
          if (!paramsResult.success) {
            return createValidationError(reply, "params", paramsResult.error);
          }
          params = paramsResult.data;
        }

        // Build request object with validated data
        const customRequest: CustomEndpointRequest = {
          body,
          query,
          params,
          headers: req.headers as Record<string, string | string[] | undefined>,
          clientId,
        };

        // Merge additional context if provided (e.g., permissions from contextExtractor)
        if (options?.contextExtractor) {
          const additionalContext = await options.contextExtractor(req);
          Object.assign(customRequest, additionalContext);
        }

        // Call the user-defined handler with validated and typed data
        const result = await endpoint.handler(customRequest as any);

        // Validate response if schema provided
        if (endpoint.responseSchema) {
          const responseResult = endpoint.responseSchema.safeParse(result);
          if (!responseResult.success) {
            // Log the validation error for debugging
            console.error(
              `Response validation failed for ${endpoint.method} ${endpoint.path}:`,
              responseResult.error
            );

            // Return generic error to prevent information leakage
            reply.code(500);
            return {
              error: {
                code: "RESPONSE_VALIDATION_ERROR",
                message: "Internal server error: invalid response format",
              },
            } as EndpointErrorResponse;
          }
          // Return validated response data
          return responseResult.data;
        }

        // No response validation - return result as-is
        return result;
      } catch (error) {
        // Handle any errors thrown by the handler
        console.error(
          `Error in custom endpoint ${endpoint.method} ${endpoint.path}:`,
          error
        );

        reply.code(500);
        return {
          error: {
            code: "INTERNAL_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          },
        } as EndpointErrorResponse;
      }
    });
  }
}

/**
 * Creates a standardized validation error response.
 * Returns 400 status code with detailed Zod validation errors.
 *
 * @param reply - Fastify reply object
 * @param field - The field that failed validation (body, query, or params)
 * @param error - Zod validation error
 * @returns Formatted error response
 * @private
 */
function createValidationError(
  reply: FastifyReply,
  field: string,
  error: z.ZodError
): EndpointErrorResponse {
  reply.code(400);
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: `Validation failed for ${field}`,
      details: error.errors,
    },
  };
}
