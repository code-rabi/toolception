# Core Module

## Purpose

Central orchestration layer. Manages toolset lifecycle, tool registration, and server initialization.

## Key Components

- **ServerOrchestrator** — Entry point wiring ModuleResolver + DynamicToolManager + ToolRegistry. Resolves startup mode, initializes toolsets, optionally registers meta-tools.
- **DynamicToolManager** — Enable/disable toolsets at runtime. Validates names, checks exposure policy, resolves tools via ModuleResolver, registers via ToolRegistry.
- **ToolRegistry** — Tool name registry with collision detection and optional namespacing (`toolset.toolName`).

## Invariants

1. **All tools go through ToolRegistry** — Collision detection happens here only. Bypassing it causes silent name conflicts.
2. **Disable is state-only** — MCP SDK has no `server.removeTool()`; disabled toolsets' tools remain callable by clients. `activeToolsets` tracks logical state only.
3. **Notifications may fail silently** — "Not connected" errors are expected during SSE disconnect and are swallowed.
4. **Namespacing applied BEFORE collision check** — `mapAndValidate()` generates safe names first, then checks for conflicts.
5. **Toolset added to activeToolsets AFTER registration** — All tools must register successfully before toolset is marked active. Partial failures leave the toolset inactive but orphaned tools remain registered (MCP limitation).
6. **`enableToolsets()` batches notifications** — Calls `enableToolset(name, skipNotification=true)` per toolset, sends one `tools/list_changed` notification at the end.
7. **JSON Schema `inputSchema` uses `registerTool` with a passthrough object** — The SDK rejects plain JSON Schema as a tool schema. Zod raw shapes and schemas are passed to `registerTool` as is. Clients see an open object schema for JSON Schema tools, not the declared one.
8. **Startup failures make the orchestrator not ready** — `enableToolsets()` reports failures in its result and never throws, so `initializeToolsets()` turns any failed result into `initError`. `isReady()` is then `false` and `ensureReady()` throws. Module loader errors are the exception: `ModuleResolver` logs them and continues, so they do not fail a toolset.

## Enable Toolset Flow

```
enableToolset(name)
  → validateToolsetForEnable(name) → fail fast if invalid/already active
  → checkExposurePolicy(name) → fail fast if denied by allowlist/denylist/maxActive
  → resolveAndRegisterTools(name) → ModuleResolver + ToolRegistry
  → activeToolsets.add(name) — only after successful registration
  → notifyToolsChanged() — unless skipNotification
```

## SDK registration

Tools are registered with `McpServer.registerTool` (the 5-arg `server.tool()` overloads are deprecated). Before 1.28 the SDK silently treated a JSON Schema `inputSchema` as annotations, so handlers received the request `extra` instead of arguments; newer SDKs throw. `isZodInputSchema()` routes Zod shapes straight through and everything else to the passthrough object.

## Anti-patterns

- Bypassing ToolRegistry for tool registration (causes collision issues)
- Expecting disable to unregister tools from MCP (it can't)
- Throwing on notification failures (they're expected in SSE disconnect)
- Using `_meta` as a toolset key in the catalog (reserved for meta-tools — see `src/meta/AGENTS.md`)

## Dependencies

- Imports: `src/types`, `src/mode`, `src/meta`
- Used by: `src/server/*`, `src/http/*`

---
*Keep this Intent Node updated when modifying core orchestration. See root AGENTS.md for maintenance guidelines.*
