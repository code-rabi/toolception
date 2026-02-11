# Server Module

## Purpose

Factory functions for creating MCP servers. Provides standard and permission-based server creation with configuration validation.

## Key Components

- **createMcpServer** (`createMcpServer.ts`) — Standard server factory supporting DYNAMIC or STATIC modes. Returns `McpServerHandle`. Delegates to named helpers: `validateOptions`, `buildSessionContextResolver`, `buildOrchestrator`, `createBundleFactory`, `buildTransport`.
- **createPermissionBasedMcpServer** (`createPermissionBasedMcpServer.ts`) — Permission-controlled server factory. Always STATIC per client, no meta-tools. Delegates to: `validatePermissionOptions`, `buildPermissionResolver`, `buildPermissionOrchestrator`, `createClientOrchestratorFactory`, `buildPermissionTransport`.
- **McpServerHandle** (`server.types.ts`) — Shared return type: `{server, start(), close()}`.
- **Shared utilities** (`server.utils.ts`) — `validateStartupConfig`, `createToolsChangedNotifier`, `resolveMetaToolsFlag`.

## Invariants

1. **Startup config validated via Zod `.strict()`** — Catches typos in config keys (e.g., `initialToolsets` instead of `toolsets`).
2. **STATIC + sessionContext = warning** — Session context has limited effect in STATIC mode since all clients share one server.
3. **Permission-based servers reject `startup` field** — Throws if `startup` provided. Toolsets come from permissions, not config.
4. **Permission-based sanitizes exposure policy** — `sanitizeExposurePolicyForPermissions` strips allowlist/denylist/maxActiveToolsets with warnings.
5. **`ensureReady()` before transport start** — STATIC mode waits for toolset initialization to complete.
6. **Orchestrator built via conditional builder calls** — Optional fields (`exposurePolicy`, `startup`) passed to builder only when defined. Never use `!` to coerce.

## Notifier Pattern

`createToolsChangedNotifier()` returns a function that duck-types the MCP server to find notification capability. Two type-guard paths exist (NotifierA / NotifierB) because the MCP SDK exposes `server.notification()` through different interfaces depending on connection state. "Not connected" errors are expected during SSE disconnect and are swallowed silently.

## Server Architecture

**Standard (createMcpServer):**
```
DYNAMIC: Per-client ServerOrchestrator + MCP Server (fresh per bundle)
STATIC:  Shared singleton — all clients reuse one server + orchestrator
```

**Permission-based (createPermissionBasedMcpServer):**
```
Base orchestrator (empty, STATIC) for /tools status endpoint
Per-client orchestrators loaded with allowed toolsets only
Always STATIC per client, no meta-tools
```

## Anti-patterns

- Providing `startup` to permission-based server (throws)
- Expecting allowlist/denylist to work with permission-based (stripped silently)
- Not awaiting `start()` before accepting requests
- Using non-null assertions (`!`) on optional builder params — use conditional calls instead

## Dependencies

- Imports: `src/types`, `src/core`, `src/http`, `src/session`, `src/permissions`
- Used by: Application entry points

---
*Keep this Intent Node updated when modifying server creation. See root AGENTS.md for maintenance guidelines.*
