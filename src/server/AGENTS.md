# Server Module

## Purpose

Factory functions for creating MCP servers. Provides standard and permission-based server creation with configuration validation.

## Key Components

**createMcpServer** (`createMcpServer.ts`)
- Standard server factory supporting DYNAMIC or STATIC modes
- Returns `McpServerHandle` (`{server, start(), close()}`)
- Supports session context for multi-tenancy
- Main flow delegates to named helpers: `validateOptions`, `buildSessionContextResolver`, `buildOrchestrator`, `createBundleFactory`, `buildTransport`

**createPermissionBasedMcpServer** (`createPermissionBasedMcpServer.ts`)
- Permission-controlled server factory
- Always STATIC mode per client
- No meta-tools (clients can't change toolsets)
- Main flow delegates to named helpers: `validatePermissionOptions`, `buildPermissionResolver`, `buildPermissionOrchestrator`, `createClientOrchestratorFactory`, `buildPermissionTransport`

**Shared types** (`server.types.ts`)
- `CreateMcpServerOptions` — options for standard server
- `McpServerHandle` — return type for both factories (`{server, start, close}`)

**Shared utilities** (`server.utils.ts`)
- `validateStartupConfig(startup)` — Zod parse + error formatting
- `createToolsChangedNotifier()` — encapsulated notifier pattern (type guards as closure)
- `resolveMetaToolsFlag(explicit, mode)` — meta-tools default: on for DYNAMIC, off for STATIC

## createMcpServer Options

```typescript
{
  catalog: ToolSetCatalog,           // Required
  createServer: () => McpServer,     // Required - factory function
  moduleLoaders?: Record<string, ModuleLoader>,
  exposurePolicy?: ExposurePolicy,
  context?: unknown,
  startup?: {
    mode?: "DYNAMIC" | "STATIC",
    toolsets?: string[] | "ALL"
  },
  registerMetaTools?: boolean,       // Default: true for DYNAMIC
  http?: FastifyTransportOptions,
  sessionContext?: SessionContextConfig
}
```

## createPermissionBasedMcpServer Options

```typescript
{
  catalog: ToolSetCatalog,           // Required
  createServer: () => McpServer,     // Required
  permissions: PermissionConfig,     // Required
  moduleLoaders?: Record<string, ModuleLoader>,
  exposurePolicy?: ExposurePolicy,   // Sanitized - see invariant #4
  context?: unknown,
  http?: FastifyTransportOptions,
  sessionContext?: SessionContextConfig  // Limited support
}
```

## Invariants

1. **Startup config validated via Zod .strict()** - Catches typos in config keys
2. **STATIC + sessionContext = warning** - Session context has limited effect in STATIC mode
3. **Permission-based servers ignore startup field** - Throws if `startup` provided
4. **Permission-based sanitizes exposure policy** - Strips allowlist/denylist/maxActiveToolsets with warnings
5. **Orchestrator.ensureReady() before start** - STATIC mode waits for initialization
6. **Orchestrator built via conditional builder calls** - Optional fields (`exposurePolicy`, `startup`) are only passed to the builder when defined; never use `!` to coerce them

## Mode Selection Logic

```
If startup.mode specified:
  → Use specified mode
Else if startup.toolsets === "ALL":
  → STATIC mode, enable all
Else if startup.toolsets is array:
  → STATIC mode, enable specified
Else:
  → DYNAMIC mode (default)
```

## Server Architecture

**Standard (createMcpServer):**
```
DYNAMIC: Per-client ServerOrchestrator + MCP Server
STATIC: Shared ServerOrchestrator, tools pre-loaded
```

**Permission-based (createPermissionBasedMcpServer):**
```
Base orchestrator (empty) for status endpoints
Per-client orchestrators loaded with allowed toolsets
Always STATIC per client, no meta-tools
```

## Anti-patterns

- Providing `startup` to permission-based server (throws)
- Expecting allowlist/denylist to work with permission-based (ignored)
- Not awaiting `start()` before accepting requests
- Using non-null assertions (`!`) on optional builder params — use conditional calls instead

## Dependencies

- Imports: `src/types`, `src/core`, `src/http`, `src/session`, `src/permissions`
- Used by: Application entry points

## See Also

- `src/core/AGENTS.md` - ServerOrchestrator internals
- `src/http/AGENTS.md` - Transport layer
- `src/permissions/AGENTS.md` - Permission resolution

---
*Keep this Intent Node updated when modifying server creation. See root AGENTS.md for maintenance guidelines.*
