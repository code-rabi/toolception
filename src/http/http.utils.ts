import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  CustomEndpointDefinition,
  CustomEndpointRequest,
  EndpointErrorResponse,
  HttpMethod,
  PermissionAwareEndpointHandler,
  PermissionAwareEndpointRequest,
  RegisterCustomEndpointsOptions,
} from "./http.types.js";

// --- defineEndpoint (from customEndpoints.ts) ---

/**
 * Helper function to create type-safe custom endpoints with automatic type inference.
 * Provides better IntelliSense and type checking for endpoint definitions.
 *
 * @template TBody - Zod schema for request body
 * @template TQuery - Zod schema for query parameters
 * @template TParams - Zod schema for path parameters
 * @template TResponse - Zod schema for response
 *
 * @param definition - Endpoint definition with schemas and handler
 * @returns The same endpoint definition with full type inference
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { defineEndpoint } from "toolception";
 *
 * const getUsersEndpoint = defineEndpoint({
 *   method: "GET",
 *   path: "/users",
 *   querySchema: z.object({
 *     limit: z.coerce.number().int().positive().default(10),
 *     role: z.enum(["admin", "user"]).optional(),
 *   }),
 *   responseSchema: z.object({
 *     users: z.array(z.object({
 *       id: z.string(),
 *       name: z.string(),
 *     })),
 *     total: z.number(),
 *   }),
 *   handler: async (req) => {
 *     // req.query is fully typed: { limit: number, role?: "admin" | "user" }
 *     const { limit, role } = req.query;
 *
 *     return {
 *       users: [{ id: "1", name: "Alice" }],
 *       total: 1,
 *     };
 *   },
 * });
 * ```
 */
export function defineEndpoint<
  TBody extends z.ZodTypeAny = z.ZodNever,
  TQuery extends z.ZodTypeAny = z.ZodNever,
  TParams extends z.ZodTypeAny = z.ZodNever,
  TResponse extends z.ZodTypeAny = z.ZodAny
>(
  definition: CustomEndpointDefinition<TBody, TQuery, TParams, TResponse>
): CustomEndpointDefinition<TBody, TQuery, TParams, TResponse> {
  return definition;
}

// --- definePermissionAwareEndpoint (from customEndpoints.ts) ---

/**
 * Helper function to create permission-aware custom endpoints for permission-based servers.
 * Similar to defineEndpoint but with access to permission context in the handler.
 *
 * @template TBody - Zod schema for request body
 * @template TQuery - Zod schema for query parameters
 * @template TParams - Zod schema for path parameters
 * @template TResponse - Zod schema for response
 *
 * @param definition - Endpoint definition with permission-aware handler
 * @returns Endpoint definition compatible with permission-based servers
 *
 * @example
 * ```typescript
 * import { definePermissionAwareEndpoint } from "toolception";
 *
 * const statsEndpoint = definePermissionAwareEndpoint({
 *   method: "GET",
 *   path: "/my-permissions",
 *   responseSchema: z.object({
 *     toolsets: z.array(z.string()),
 *     count: z.number(),
 *   }),
 *   handler: async (req) => {
 *     // req.allowedToolsets and req.failedToolsets are available
 *     return {
 *       toolsets: req.allowedToolsets,
 *       count: req.allowedToolsets.length,
 *     };
 *   },
 * });
 * ```
 */
export function definePermissionAwareEndpoint<
  TBody extends z.ZodTypeAny = z.ZodNever,
  TQuery extends z.ZodTypeAny = z.ZodNever,
  TParams extends z.ZodTypeAny = z.ZodNever,
  TResponse extends z.ZodTypeAny = z.ZodAny
>(definition: {
  method: HttpMethod;
  path: string;
  bodySchema?: TBody;
  querySchema?: TQuery;
  paramsSchema?: TParams;
  responseSchema?: TResponse;
  handler: PermissionAwareEndpointHandler<TBody, TQuery, TParams, TResponse>;
  description?: string;
}): CustomEndpointDefinition<TBody, TQuery, TParams, TResponse> {
  // Internal conversion: permission-aware handler is compatible with standard handler
  // The permission fields will be injected by the registration logic
  return definition as any;
}

// --- registerCustomEndpoints (from endpointRegistration.ts) ---

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
 * @param reply - Fastify reply object
 * @param field - The field that failed validation
 * @param error - Zod validation error
 * @returns Formatted error response
 */
export function createValidationError(
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
