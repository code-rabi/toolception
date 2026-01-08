import { z } from "zod";

/**
 * Supported HTTP methods for custom endpoints
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Request context passed to custom endpoint handlers.
 * Contains validated and typed request data without exposing Fastify types.
 */
export interface CustomEndpointRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown
> {
  /**
   * Validated request body (typed from bodySchema)
   */
  body: TBody;

  /**
   * Validated query parameters (typed from querySchema)
   */
  query: TQuery;

  /**
   * Validated path parameters (typed from paramsSchema)
   */
  params: TParams;

  /**
   * Raw request headers
   */
  headers: Record<string, string | string[] | undefined>;

  /**
   * Client ID (from mcp-client-id header or auto-generated for anonymous clients)
   */
  clientId: string;
}

/**
 * Permission-aware request context for custom endpoints in permission-based servers.
 * Extends CustomEndpointRequest with permission information.
 */
export interface PermissionAwareEndpointRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown
> extends CustomEndpointRequest<TBody, TQuery, TParams> {
  /**
   * Toolsets this client is allowed to access (resolved from permissions)
   */
  allowedToolsets: string[];

  /**
   * Toolsets that failed to enable for this client
   */
  failedToolsets: string[];
}

/**
 * Handler function type with automatic type inference from Zod schemas.
 * Receives validated and typed request data, returns typed response.
 */
export type CustomEndpointHandler<
  TBody extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TParams extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny
> = (
  request: CustomEndpointRequest<
    TBody extends z.ZodTypeAny ? z.infer<TBody> : never,
    TQuery extends z.ZodTypeAny ? z.infer<TQuery> : never,
    TParams extends z.ZodTypeAny ? z.infer<TParams> : never
  >
) => Promise<z.infer<TResponse>> | z.infer<TResponse>;

/**
 * Permission-aware handler function type for permission-based servers.
 * Receives permission context in addition to validated request data.
 */
export type PermissionAwareEndpointHandler<
  TBody extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TParams extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny
> = (
  request: PermissionAwareEndpointRequest<
    TBody extends z.ZodTypeAny ? z.infer<TBody> : never,
    TQuery extends z.ZodTypeAny ? z.infer<TQuery> : never,
    TParams extends z.ZodTypeAny ? z.infer<TParams> : never
  >
) => Promise<z.infer<TResponse>> | z.infer<TResponse>;

/**
 * Custom HTTP endpoint definition with Zod schema-based validation and type inference.
 * Allows defining REST-like endpoints alongside MCP protocol endpoints.
 *
 * @template TBody - Zod schema for request body validation
 * @template TQuery - Zod schema for query parameter validation
 * @template TParams - Zod schema for path parameter validation
 * @template TResponse - Zod schema for response validation
 *
 * @example
 * ```typescript
 * const getUserEndpoint = defineEndpoint({
 *   method: "GET",
 *   path: "/users/:userId",
 *   paramsSchema: z.object({
 *     userId: z.string().uuid(),
 *   }),
 *   responseSchema: z.object({
 *     id: z.string(),
 *     name: z.string(),
 *   }),
 *   handler: async (req) => {
 *     // req.params is typed: { userId: string }
 *     const { userId } = req.params;
 *     return { id: userId, name: "Alice" };
 *   },
 * });
 * ```
 */
export interface CustomEndpointDefinition<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TResponse extends z.ZodTypeAny = z.ZodTypeAny
> {
  /**
   * HTTP method for this endpoint
   */
  method: HttpMethod;

  /**
   * URL path (relative to basePath). Supports path parameters using :param syntax.
   *
   * @example
   * - "/users" - Simple path
   * - "/users/:id" - Path with single parameter
   * - "/items/:category/:id" - Path with multiple parameters
   */
  path: string;

  /**
   * Optional Zod schema for request body validation (typically used with POST, PUT, PATCH).
   * Enables automatic type inference for handler body parameter.
   */
  bodySchema?: TBody;

  /**
   * Optional Zod schema for query parameter validation.
   * Enables automatic type inference for handler query parameter.
   *
   * @example
   * ```typescript
   * querySchema: z.object({
   *   limit: z.coerce.number().int().positive().default(10),
   *   offset: z.coerce.number().int().nonnegative().default(0),
   * })
   * ```
   */
  querySchema?: TQuery;

  /**
   * Optional Zod schema for path parameter validation.
   * Enables automatic type inference for handler params parameter.
   */
  paramsSchema?: TParams;

  /**
   * Optional Zod schema for response validation.
   * Enables automatic type inference for handler return type.
   * If validation fails, returns 500 error to prevent information leakage.
   */
  responseSchema?: TResponse;

  /**
   * Request handler function with inferred types from schemas.
   * Receives validated and typed request data, returns typed response.
   */
  handler: CustomEndpointHandler<TBody, TQuery, TParams, TResponse>;

  /**
   * Optional description for documentation purposes
   */
  description?: string;
}

/**
 * Standard error response structure for custom endpoints
 */
export interface EndpointErrorResponse {
  error: {
    /**
     * Error code indicating the type of error
     * - VALIDATION_ERROR: Request validation failed (400)
     * - INTERNAL_ERROR: Handler threw an error (500)
     * - RESPONSE_VALIDATION_ERROR: Response validation failed (500)
     */
    code: "VALIDATION_ERROR" | "INTERNAL_ERROR" | "RESPONSE_VALIDATION_ERROR";

    /**
     * Human-readable error message
     */
    message: string;

    /**
     * Optional additional error details (e.g., Zod validation errors)
     */
    details?: unknown;
  };
}

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
