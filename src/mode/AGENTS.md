# Mode Module

## Purpose

Handles toolset resolution, validation, and module loading. Bridges toolset definitions and tool instances.

## Key Components

- **ModuleResolver** (`ModuleResolver.ts`) — Stores catalog, validates toolset names, resolves tools by collecting direct tools + calling module loaders.
- **ToolsetValidator** (`ModeResolver.ts`) — Validates toolset names against a provided catalog, parses comma-separated toolset strings. Also resolves startup mode from env/args.

## Invariants

1. **Module loaders fail silently** — Errors caught, logged as warnings, skipped. Toolset activates with whatever tools succeeded. This is intentional — one broken loader should not block the rest.
2. **ToolsetValidator is in ModeResolver.ts** — Historical naming quirk. `ToolsetValidator.ts` just re-exports from `ModeResolver.ts`. Import from either file.
3. **ModuleResolver stores catalog; ToolsetValidator takes it as parameter** — Different validation signatures. ModuleResolver validates against its stored catalog; ToolsetValidator is stateless.
4. **Context passed to module loaders** — Enables dynamic tool generation based on runtime context (e.g., per-client tools).

## Module Loading Flow

```
resolveToolsForToolsets([toolsetName], context)
  For each toolset:
    1. Collect direct tools from definition.tools[]
    2. For each module in definition.modules[]:
       → Look up loader in moduleLoaders map
       → Call loader(context) — may be async
       → Catch errors → warn and skip (invariant #1)
       → Append returned tools
  Return flattened McpToolDefinition[]
```

## Anti-patterns

- Throwing on invalid toolset names (return validation result instead)
- Assuming module loaders are synchronous (always await)
- Using `ToolsetValidator.ts` directly when `ModeResolver.ts` is clearer

## Dependencies

- Imports: `src/types`
- Used by: `src/core/ServerOrchestrator`, `src/core/DynamicToolManager`

---
*Keep this Intent Node updated when modifying mode resolution. See root AGENTS.md for maintenance guidelines.*
