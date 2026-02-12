# Permissions Module

## Purpose

Provides per-client access control for toolsets. Supports header-based and config-based permission resolution with caching.

## Key Components

- **PermissionResolver** (`PermissionResolver.ts`) — Resolves allowed toolsets for a client. Supports header and config sources with caching.
- **validatePermissionConfig** (`permissions.utils.ts`) — Validates PermissionConfig structure at startup.
- **createPermissionAwareBundle** (`permissions.utils.ts`) — Wraps bundle creation with permission enforcement. Returns `{server, orchestrator, allowedToolsets, failedToolsets}`.
- **sanitizeExposurePolicyForPermissions** (`permissions.utils.ts`) — Strips `allowlist`, `denylist`, and `maxActiveToolsets` from ExposurePolicy with warnings. Permissions handle access control instead — these policy fields would conflict.
- **PermissionAwareFastifyTransport** (`PermissionAwareFastifyTransport.ts`) — HTTP transport variant with per-client permission enforcement via ClientResourceCache.

## Invariants

1. **Permission cache has no TTL** — Must call `invalidateCache()` or `clearCache()` manually when permissions change. There is no automatic expiration.
2. **Header lookup is case-insensitive** — Per RFC 7230.
3. **Fail-secure resolution** — Invalid permissions return empty array, not error. Client gets no toolsets.
4. **All toolsets fail = throw** — If every requested toolset fails to enable, it's likely a config error. Partial success continues with warning.

## Resolution Priority (config source)

```
1. resolver(clientId) → if provided and returns valid array
2. staticMap[clientId] → if client exists in map
3. defaultPermissions → fallback array
4. [] → if nothing else (fail-secure)
```

## Caching Behavior

**PermissionResolver cache:**
- Keyed by clientId
- NO automatic expiration — manual `invalidateCache(clientId)` or `clearCache()` required
- This is a deliberate design choice: permissions change infrequently, and stale cache is preferable to repeated resolver calls

**PermissionAwareFastifyTransport cache:**
- Keyed by clientId (all MCP clients, since header is required)
- LRU eviction with onEvict cleanup (closes all sessions in bundle)

## Permission Flow

```
HTTP Request with mcp-client-id header
  → PermissionAwareFastifyTransport extracts client context
  → createPermissionAwareBundle(context)
  → PermissionResolver.resolve(clientId, headers)
  → Create STATIC mode server with allowed toolsets only
  → Return bundle (cached for reuse)
```

## Anti-patterns

- Expecting cache to auto-invalidate (it won't — see invariant #1)
- Sending MCP protocol requests without `mcp-client-id` header (returns 400)
- Trusting client-provided permissions without config-based fallback
- Providing allowlist/denylist to permission-based server (stripped silently by `sanitizeExposurePolicyForPermissions`)

## Dependencies

- Imports: `src/types`, `src/core`, `src/session`
- Used by: `src/server/createPermissionBasedMcpServer`

---
*Keep this Intent Node updated when modifying permissions. See root AGENTS.md for maintenance guidelines.*
