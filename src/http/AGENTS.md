# HTTP Module

## Purpose

Provides Fastify-based HTTP transport for the MCP protocol. Handles SSE streams, JSON-RPC requests, and per-client server management.

## Key Components

**FastifyTransport** (`FastifyTransport.ts`)
- Main HTTP transport using Fastify
- Per-client bundles via ClientResourceCache
- Optional SessionContextResolver for context differentiation

**Custom Endpoints** (`customEndpoints.ts`, `endpointRegistration.ts`)
- Type-safe endpoint definitions with Zod schemas
- `defineEndpoint()` / `definePermissionAwareEndpoint()` helpers
- Automatic request/response validation

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

1. **`mcp-client-id` header required** - All MCP protocol endpoints (POST, GET, DELETE) reject requests without this header (400). Custom endpoints still generate `anon-${UUID}` fallback.
2. **Session created on POST /mcp initialize** - Tracked in `bundle.sessions` Map
3. **Cache key format** - `${clientId}:${contextHash}` when session context differs
4. **Reserved paths cannot be overridden** - `/mcp`, `/healthz`, `/tools`, `/.well-known/mcp-config`

## Request Extraction

```typescript
// Headers normalized to lowercase
headers: Record<string, string>

// Query params filtered to string values
query: Record<string, string>

// Client ID from header (required for /mcp endpoints, auto-generated for custom endpoints)
clientId: headers['mcp-client-id']
```

## Session Lifecycle

```
1. POST /mcp (initialize)
   → Create StreamableHTTPServerTransport
   → Generate session ID
   → Store in bundle.sessions

2. GET /mcp (streaming)
   → Require mcp-session-id header
   → Delegate to transport.handleRequest()
   → Maintain SSE connection

3. POST /mcp (subsequent)
   → Use existing session
   → Route JSON-RPC through transport

4. DELETE /mcp (cleanup)
   → Remove session from bundle
   → Close transport
```

## Custom Endpoint Registration

```typescript
// Standard endpoint
defineEndpoint({
  path: '/my-endpoint',
  method: 'POST',
  body: z.object({ data: z.string() }),
  handler: async (req, manager) => ({ result: 'ok' })
})

// Permission-aware (includes allowedToolsets, failedToolsets)
definePermissionAwareEndpoint({...})
```

## Anti-patterns

- Registering endpoints on reserved paths (throws)
- Sending MCP protocol requests without `mcp-client-id` header (returns 400)
- Blocking on SSE handlers (should be async)

## Dependencies

- Imports: `src/types`, `src/core`, `src/session`
- Used by: `src/server/createMcpServer`

## See Also

- `src/session/AGENTS.md` - SessionContextResolver, ClientResourceCache
- `src/permissions/AGENTS.md` - PermissionAwareFastifyTransport
- `src/server/AGENTS.md` - How transport is configured

---
*Keep this Intent Node updated when modifying HTTP transport. See root AGENTS.md for maintenance guidelines.*
