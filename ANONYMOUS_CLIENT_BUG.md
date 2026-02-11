# Anonymous Client Bug - Second Request Failure

## Problem Statement

When a client connects to the Toolception MCP server **without** providing an `mcp-client-id` header, the second request always fails with:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Session not found or expired"
  }
}
```

This occurs even when the client properly sends the `mcp-session-id` header received from the initialize response.

## Root Cause Analysis

The issue stems from two compounding problems in `src/http/FastifyTransport.ts`:

### Problem 1: New Anonymous ID Per Request

**Location:** `FastifyTransport.ts:131-137`

```typescript
const clientIdHeader = (req.headers["mcp-client-id"] as string | undefined)?.trim();
const clientId =
  clientIdHeader && clientIdHeader.length > 0
    ? clientIdHeader
    : `anon-${randomUUID()}`;  // ← GENERATES NEW UUID EVERY REQUEST
```

Each request without an `mcp-client-id` header gets a **different** anonymous ID:
- Request 1: `anon-abc123`
- Request 2: `anon-def456` ← Different!

### Problem 2: Anonymous Clients Not Cached

**Location:** `FastifyTransport.ts:139-156`

```typescript
// When anon id, avoid caching (one-off)
const useCache = !clientId.startsWith("anon-");  // ← useCache = false

let bundle = useCache ? this.clientCache.get(cacheKey) : null;
if (!bundle) {
  const created = this.createBundle(mergedContext);
  bundle = {
    server: created.server,
    orchestrator: created.orchestrator,
    sessions: new Map(),  // ← Fresh, empty sessions Map
  };
  if (useCache) this.clientCache.set(cacheKey, bundle);  // ← SKIPPED for anon
}
```

Anonymous clients:
1. Skip cache lookup (`useCache = false`)
2. Create fresh bundle with empty `sessions` Map
3. Skip cache storage

## Request Flow Breakdown

### Request 1 (Initialize)

```
1. Client sends POST /mcp (no mcp-client-id header)
2. Server generates: clientId = "anon-abc123"
3. useCache = false
4. bundle = null (cache skipped)
5. Create NEW bundle with empty sessions Map
6. Initialize creates transport
7. Session stored: bundle.sessions.set("session-xyz", transport)
   ↑ Stored in uncached bundle
8. Response sent to client with mcp-session-id: "session-xyz"
9. Bundle NOT cached (useCache is false)
   ↑ Bundle is discarded after response
```

### Request 2 (Tool Call)

```
1. Client sends POST /mcp
   Headers: { "mcp-session-id": "session-xyz" }
2. Server generates: clientId = "anon-def456"  ← DIFFERENT ID
3. useCache = false
4. bundle = null (cache skipped)
5. Create NEW bundle with EMPTY sessions Map
   ↑ Previous session lost
6. Try to find session: bundle.sessions.get("session-xyz")
   → Returns undefined (sessions Map is empty)
7. Falls through to error (line 186-192)
8. Returns 400: "Session not found or expired"
```

## Why This Happens

The MCP protocol requires **session continuity** across multiple requests:
1. Initialize request creates a session
2. Subsequent requests reuse that session via `mcp-session-id`

For this to work, the server must:
- **Recognize the same client** across requests
- **Persist the session state** (the bundle with sessions Map)

Anonymous clients fail both requirements:
- ❌ Different `clientId` each request (new UUID)
- ❌ Bundles not cached (destroyed after each request)

## Impact

This bug makes the MCP protocol **completely broken** for anonymous clients:
- ✅ Initialize works (creates session)
- ❌ All subsequent requests fail (session not found)
- ❌ SSE streaming broken
- ❌ Tool calls impossible
- ❌ Multi-request workflows impossible

## Solution: Require mcp-client-id Header

**Recommended Fix:** Make `mcp-client-id` header **required** for all MCP protocol requests.

**Rationale:**
- MCP protocol inherently requires session continuity
- Session continuity requires client identity persistence
- Anonymous mode is fundamentally incompatible with the protocol
- Requiring the header makes expectations clear

### Implementation Details

1. **Add Zod validation** for the header in POST /mcp, GET /mcp, DELETE /mcp
2. **Return 400 error** if header is missing or empty
3. **Update documentation** (README.md, AGENTS.md files)
4. **Update tests** to always provide the header
5. **Remove anonymous ID generation** logic

## Files to Modify

- `src/http/FastifyTransport.ts` - Add header validation
- `src/http/PermissionAwareFastifyTransport.ts` - Same validation
- `src/http/AGENTS.md` - Update invariants and docs
- `README.md` - Update client integration examples
- `tests/fastifyTransport.test.ts` - Update test expectations
- `tests/smoke-e2e/README.md` - Update examples
- Any other test files using anonymous connections
