# Core Module

## Purpose

Central orchestration layer. Manages toolset lifecycle, tool registration, and server initialization.

## Key Components

- **ServerOrchestrator** — Entry point wiring ModuleResolver + DynamicToolManager + ToolRegistry. Resolves startup mode, initializes toolsets, optionally registers meta-tools.
- **DynamicToolManager** — Enable/disable toolsets at runtime. Validates names, checks exposure policy, resolves tools via ModuleResolver, registers via ToolRegistry.
- **ToolRegistry** — Tool name registry with collision detection and optional namespacing (`toolset.toolName`).

## Invariants

1. **All tools go through ToolRegistry** — Collision detection happens here only. Bypassing it causes silent name conflicts.
2. **Disable unregisters the tools** — `DynamicToolManager` keeps the `RegisteredTool` handle `registerTool()` returns for each tool and calls `remove()` on disable, then frees the names in ToolRegistry (`removeForToolset`) so the toolset can be enabled again. Disabled tools are neither listed nor callable.
3. **Notifications may fail silently** — "Not connected" errors are expected during SSE disconnect and are swallowed.
4. **Namespacing applied BEFORE collision check** — `mapAndValidate()` generates safe names first, then checks for conflicts.
5. **Toolset added to activeToolsets AFTER registration** — All tools must register successfully before toolset is marked active. A partial failure removes the tools already registered, so nothing is left callable and the toolset can be enabled again.
6. **`enableToolsets()` batches notifications** — Calls `enableToolset(name, skipNotification=true)` per toolset, sends one `tools/list_changed` notification at the end. The SDK also sends its own `tools/list_changed` for every `registerTool()` and `remove()` call on a connected server, so a disable of N tools sends N+1.
7. **`inputSchema` goes through `toRegistrableInputSchema()`** — A Zod 4 schema instance is used as is; a raw shape of Zod 4 values is wrapped with toolception's own `z.object()` (so the SDK never wraps it with a second copy of Zod); a Zod 3 schema throws `ToolingError` `E_VALIDATION` (SDK v2 cannot read it) and the enable fails; a JSON Schema object with root `type: "object"` goes through the SDK's `fromJsonSchema()`, so clients see the declared schema and arguments are validated before the handler runs; a missing or non-object schema registers as `z.looseObject({})`; anything else (a root `type` that is not the string `"object"`, which includes a shape mixing Zod and non-Zod values; a JSON Schema that fails to compile) throws `ToolingError` `E_VALIDATION` at registration, so the enable fails. The root `$id` is dropped before compiling (the validator caches by `$id`, so two tools sharing one would share the first one's validator).
8. **Failed tool registration at startup makes the orchestrator not ready** — `enableToolsets()` reports failures in its result and never throws. A failure that carries a `code` (set when enabling threw, normally while registering the toolset's tools, e.g. a tool name collision) becomes `initError`, so `isReady()` is `false` and `ensureReady()` throws. Refusals made before any registration (invalid name, already enabled, exposure policy) carry no code and are ignored. Module loader errors are also ignored: `ModuleResolver` logs them and continues.
9. **JSON Schema validators are per manager** — Each `DynamicToolManager` (one per client) owns its own `AjvJsonSchemaValidator`. Ajv keeps every compiled schema for the validator's lifetime, so the SDK's process-wide default validator would hold all clients' schemas until exit; a per-manager one is freed with the client and shares nothing. Ajv's cache is never evicted when a toolset is disabled, so a client that toggles a loader-backed toolset many times grows its own cache until the session ends; that growth is bounded by the client's lifetime. Do not switch to `fromJsonSchema(schema)` without a validator argument.

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

Tools are registered with `McpServer.registerTool` (`server.tool()` no longer exists in SDK v2). The SDK does not accept a plain JSON Schema object as `inputSchema`, so `toRegistrableInputSchema()` maps every tool schema to a Zod 4 schema, or wraps a JSON Schema with `fromJsonSchema()`, first. Calling a tool that is not (or no longer) registered makes the SDK answer with a JSON-RPC error, not an `isError` result.

## Anti-patterns

- Bypassing ToolRegistry for tool registration (causes collision issues)
- Registering tools without keeping the `registerTool()` handle (disable and failed-enable rollback can't remove them)
- Throwing on notification failures (they're expected in SSE disconnect)
- Using `_meta` as a toolset key in the catalog (reserved for meta-tools — see `src/meta/AGENTS.md`)

## Dependencies

- Imports: `src/types`, `src/mode`, `src/meta`
- Used by: `src/server/*`, `src/http/*`

---
*Keep this Intent Node updated when modifying core orchestration. See root AGENTS.md for maintenance guidelines.*
