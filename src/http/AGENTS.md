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

## Session Lifecycle

```
1. POST /mcp (initialize)
   → isInitializeRequest(body) detects first contact
   → drainExistingSessions() — closes sessions in this bundle's map (same-client reconnect)
   → disconnectServer()      — closes server's current transport (STATIC cross-client case)
   → Set transport.onclose BEFORE server.connect() (SDK 1.26+ chain requirement)
   → server.connect(transport) — throws "Already connected" if above steps missed
   → Generate session ID, store in bundle.sessions via onsessioninitialized

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

## SDK 1.26+ Reconnection Protocol

`Protocol.connect()` throws `"Already connected"` if `this._transport` is still set. Two private methods handle the pre-connect cleanup:

- **`drainExistingSessions(sessions)`** — covers same-bundle reconnects where sessions are still in the map (e.g. client aborted without DELETE but same `clientId`)
- **`disconnectServer(server)`** — covers cross-bundle cases in STATIC mode where different clients share one `McpServer`; `StreamableHTTPClientTransport.close()` does NOT send DELETE (it only aborts connections), so `_transport` can remain set after the first client leaves

**Critical ordering**: `transport.onclose` must be assigned BEFORE `server.connect(transport)`. `Protocol.connect()` reads the existing `onclose` and wraps it in a chain that also calls `Protocol._onclose()` (which clears `_transport`). If set after `connect()`, the chain is broken and `_transport` is never cleared on disconnect.

## Anti-patterns

- Registering endpoints on reserved paths (throws)
- Sending MCP protocol requests without `mcp-client-id` header (returns 400)
- Blocking on SSE handlers (should be async)

## Dependencies

- Imports: `src/types`, `src/core`, `src/session`
- Used by: `src/server/createMcpServer`

---
*Keep this Intent Node updated when modifying HTTP transport. See root AGENTS.md for maintenance guidelines.*
