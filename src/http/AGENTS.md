# HTTP Module

## Purpose

Provides Fastify-based HTTP transport for the MCP protocol. Handles SSE streams, JSON-RPC requests, and per-client server management.

## Key Components

- **FastifyTransport** (`FastifyTransport.ts`) — Main HTTP transport. Per-client bundles via ClientResourceCache, optional SessionContextResolver for context differentiation.
- **Custom Endpoints** (`customEndpoints.ts`, `endpointRegistration.ts`) — Type-safe endpoint definitions with Zod schemas. `defineEndpoint()` / `definePermissionAwareEndpoint()` helpers.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | Health check → `{ok: true}` |
| GET | `/tools` | Default manager status |
| GET | `/.well-known/mcp-config` | Config schema discovery |
| POST | `/mcp` | JSON-RPC requests (initialize, method calls) |
| GET | `/mcp` | SSE streaming for notifications |
| DELETE | `/mcp` | Session termination |

## Invariants

1. **`mcp-client-id` header required** — All `/mcp` endpoints reject without it (400). Custom endpoints auto-generate `anon-${UUID}` fallback instead.
2. **Session created on POST /mcp initialize** — `isInitializeRequest()` from MCP SDK detects first-contact requests. New session ID generated via `randomUUID()`, stored in `bundle.sessions` Map.
3. **Cache key uses `resolveSessionContext()`** — All three `/mcp` handlers (POST, GET, DELETE) must derive the cache key through the same `resolveSessionContext()` path. Using plain `clientId` causes cache misses when session context is active.
4. **Reserved paths cannot be overridden** — `/mcp`, `/healthz`, `/tools`, `/.well-known/mcp-config` are registered before custom endpoints.

## SDK Boundary Workarounds

These `as any` casts exist because of MCP SDK / Fastify type mismatches:

- **Fastify raw req/res passthrough** — `transport.handleRequest((req as any).raw, (reply as any).raw, body)`. The SDK expects Node `http.IncomingMessage`/`http.ServerResponse` but Fastify wraps these objects.
- **`StreamableHTTPServerTransport.close()`** — The DELETE handler calls `(transport as any).close()` because `.close()` exists at runtime but is not in the SDK's TypeScript types.

## Session Lifecycle

```
1. POST /mcp (initialize)
   → isInitializeRequest(body) detects first contact
   → Create StreamableHTTPServerTransport
   → Generate session ID, store in bundle.sessions

2. GET /mcp (streaming)
   → Require mcp-session-id header
   → Delegate to transport.handleRequest()

3. POST /mcp (subsequent)
   → Look up existing session by mcp-session-id
   → Route JSON-RPC through transport

4. DELETE /mcp (cleanup)
   → Close transport (best-effort)
   → Remove session from bundle
```

## Anti-patterns

- Registering endpoints on reserved paths (throws)
- Sending MCP protocol requests without `mcp-client-id` header (returns 400)
- Blocking on SSE handlers (should be async)

## Dependencies

- Imports: `src/types`, `src/core`, `src/session`
- Used by: `src/server/createMcpServer`

---
*Keep this Intent Node updated when modifying HTTP transport. See root AGENTS.md for maintenance guidelines.*
