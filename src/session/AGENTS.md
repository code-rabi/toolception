# Session Module

## Purpose

Manages per-session context resolution and client resource caching. Enables multi-tenant scenarios where different clients/sessions need isolated contexts.

## Key Components

- **SessionContextResolver** (`SessionContextResolver.ts`) — Extracts config from query params, filters by allowed keys, merges with base context, generates deterministic cache key suffix.
- **ClientResourceCache** (`ClientResourceCache.ts`) — Generic LRU cache with TTL. Supports onEvict cleanup callbacks and background pruning.
- **validateSessionContextConfig** (`session.utils.ts`) — Validates SessionContextConfig structure at startup.

## Invariants

1. **Fail-secure parsing** — Invalid base64/JSON encoding returns `{}`, not an error. Malformed client input never crashes the server.
2. **Disallowed keys silently filtered** — No logging to prevent information leakage about what keys exist.
3. **Cache key includes context hash** — Format: `${clientId}:${sha256suffix}`. Uses SHA-256 of sorted config keys — property order does not affect the hash.
4. **LRU eviction triggers cleanup** — onEvict callback called on removal. Transport uses this to close all sessions in an evicted bundle.
5. **Background pruning interval** — Removes TTL-expired entries periodically. `stop(true)` clears all entries and triggers cleanup.

## Context Resolution Flow

```
HTTP Request with ?config=base64_encoded_data
  → parseQueryConfig() — decode base64 or JSON
  → filterAllowedKeys() — whitelist enforcement (security boundary)
  → mergeContexts() — shallow or deep merge with base context
  → generateCacheKeySuffix() — SHA-256 hash (first 16 chars, sorted keys)
  → Return {context, cacheKeySuffix}
```

## Anti-patterns

- Omitting `allowedKeys` (security risk — allows arbitrary config injection)
- Assuming cache entries persist (TTL and LRU can evict anytime)
- Blocking on cache operations (async evict callbacks are fire-and-forget)

## Dependencies

- Imports: `src/types`
- Used by: `src/http/FastifyTransport`, `src/server/createMcpServer`

---
*Keep this Intent Node updated when modifying session handling. See root AGENTS.md for maintenance guidelines.*
