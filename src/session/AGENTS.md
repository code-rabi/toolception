# Session Module

## Purpose

Manages per-session context resolution and client resource caching. Enables multi-tenant scenarios where different clients/sessions need isolated contexts.

## Key Components

**SessionContextResolver** (`SessionContextResolver.ts`)
- `resolve(request, baseContext)`: Main entry - returns `{context, cacheKeySuffix}`
- `parseQueryConfig()`: Extracts config from query param (base64 or JSON)
- `filterAllowedKeys()`: Whitelists config keys
- `mergeContexts()`: Combines base + session context
- `generateCacheKeySuffix()`: SHA-256 hash (first 16 chars) of sorted config

**ClientResourceCache** (`ClientResourceCache.ts`)
- Generic LRU cache with TTL support
- `get(key)`: Returns resource, updates LRU position
- `set(key, resource)`: Stores with auto-eviction at max capacity
- `delete(key)`: Manual removal with cleanup callback
- `stop(clearEntries?)`: Stops background pruning

**validateSessionContextConfig** (`validateSessionContextConfig.ts`)
- Validates SessionContextConfig structure
- Checks encoding, allowedKeys, merge strategy

## Invariants

1. **Fail-secure parsing** - Invalid encoding returns `{}`, not error
2. **Disallowed keys silently filtered** - No logging to prevent information leakage
3. **Cache key includes context hash** - Format: `${clientId}:${cacheKeySuffix}`
4. **LRU eviction triggers cleanup** - onEvict callback called on removal
5. **Background pruning interval** - Default 10 minutes, removes expired entries

## Cache Defaults

- `maxSize`: 1000 entries
- `ttlMs`: 3600000 (1 hour)
- `pruneIntervalMs`: 600000 (10 minutes)

## Anti-patterns

- Omitting allowedKeys (security risk - allows arbitrary config injection)
- Assuming cache entries persist (TTL and LRU can evict anytime)
- Blocking on cache operations (async evict callbacks are fire-and-forget)

## Context Resolution Flow

```
HTTP Request with ?config=base64_encoded_data
  ↓
SessionContextResolver.resolve(request, baseContext)
  ↓
parseQueryConfig() → decode base64/JSON
  ↓
filterAllowedKeys() → whitelist enforcement
  ↓
mergeContexts() → shallow or deep merge
  ↓
generateCacheKeySuffix() → deterministic hash
  ↓
Return {context, cacheKeySuffix}
```

## Dependencies

- Imports: `src/types`
- Used by: `src/http/FastifyTransport`, `src/server/createMcpServer`

## See Also

- `src/http/AGENTS.md` - How session context integrates with HTTP transport
- `src/types/AGENTS.md` - SessionContextConfig type definition

---
*Keep this Intent Node updated when modifying session handling. See root AGENTS.md for maintenance guidelines.*
