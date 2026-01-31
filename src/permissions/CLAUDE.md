# Permissions Module

## Purpose

Provides per-client access control for toolsets. Supports header-based and config-based permission resolution with caching.

## Key Components

**PermissionResolver** (`PermissionResolver.ts`)
- `resolve(clientId, headers?)`: Returns allowed toolset names
- `invalidateCache(clientId)`: Clear specific client's cached permissions
- `clearCache()`: Clear all cached permissions

**validatePermissionConfig** (`validatePermissionConfig.ts`)
- Validates PermissionConfig structure
- Ensures source is "headers" or "config"
- For config source: requires staticMap or resolver

**createPermissionAwareBundle** (`createPermissionAwareBundle.ts`)
- Wraps bundle creation with permission enforcement
- Returns `{server, orchestrator, allowedToolsets, failedToolsets}`
- Throws if ALL requested toolsets fail (likely config error)

**PermissionAwareFastifyTransport** (`PermissionAwareFastifyTransport.ts`)
- HTTP transport with permission enforcement
- Per-client bundles via ClientResourceCache
- Anonymous clients (`anon-*`) not cached

## Invariants

1. **Permission cache has no TTL** - Must call `invalidateCache()` manually when permissions change
2. **Header lookup is case-insensitive** - Per RFC 7230
3. **Fail-secure resolution** - Invalid permissions return empty array, not error
4. **All toolsets fail = throw** - Partial success continues with warning

## Resolution Priority (config source)

```
1. resolver(clientId) → if provided and returns valid array
2. staticMap[clientId] → if provided and client exists
3. defaultPermissions → fallback
4. [] → if nothing else
```

## Caching Behavior

**PermissionResolver cache:**
- Keyed by clientId
- NO automatic expiration
- Manual invalidation required

**PermissionAwareFastifyTransport cache:**
- Keyed by clientId (non-anonymous only)
- LRU eviction with onEvict cleanup
- Closes all sessions in bundle on eviction

## Anti-patterns

- Expecting cache to auto-invalidate (it won't)
- Caching anonymous client bundles (they're excluded)
- Trusting client-provided permissions without config-based fallback

## Permission Flow

```
HTTP Request with mcp-client-id header
  ↓
PermissionAwareFastifyTransport extracts client context
  ↓
createPermissionAwareBundle(context)
  ↓
PermissionResolver.resolve(clientId, headers)
  ↓
Create STATIC mode server with allowed toolsets only
  ↓
Return bundle (cached if non-anonymous)
```

## Dependencies

- Imports: `src/types`, `src/core`, `src/session`
- Used by: `src/server/createPermissionBasedMcpServer`

## See Also

- `src/http/CLAUDE.md` - FastifyTransport base class
- `src/server/CLAUDE.md` - createPermissionBasedMcpServer
- `src/types/CLAUDE.md` - PermissionConfig type

---
*Keep this Intent Node updated when modifying permissions. See root CLAUDE.md for maintenance guidelines.*
