# Meta Module

## Purpose

Registers meta-tools on MCP servers for runtime toolset management. Called by ServerOrchestrator during initialization.

## Key Components

- **registerMetaTools** (`registerMetaTools.ts`) — Registers meta-tools on a server, scoped by mode. Uses ToolRegistry for collision detection (same path as user-defined tools).
- **META_TOOLSET_KEY** — Constant `"_meta"`. All meta-tools are registered under this reserved toolset key.

## Mode-Dependent Registration

| Mode | Tools Registered |
|------|-----------------|
| DYNAMIC | `enable_toolset`, `disable_toolset`, `list_toolsets`, `describe_toolset`, `list_tools` |
| STATIC | `list_tools` only |

## Invariants

1. **`_meta` is a reserved toolset key** — If a catalog uses `"_meta"` as a toolset key, ToolRegistry will detect a name collision at registration time. Never use this key in the catalog.
2. **Meta-tools registered via ToolRegistry** — Same collision detection path as user tools. Meta-tools appear in `toolRegistry.list()` and `toolRegistry.listByToolset()`.
3. **`enable_toolset` / `disable_toolset` annotated with `destructiveHint: true`** — Visible to LLM clients via MCP tool annotations. Discovery tools (`list_*`, `describe_*`) use `readOnlyHint: true`.

## Anti-patterns

- Using `_meta` as a catalog key (collision with meta-tools)
- Registering meta-tools outside of `registerMetaTools()` (bypasses ToolRegistry)
- Expecting meta-tools in permission-based servers (they are never registered — `registerMetaTools(false)`)

## Dependencies

- Imports: `src/types`, `src/core/DynamicToolManager`, `src/core/ToolRegistry`
- Used by: `src/core/ServerOrchestrator`

---
*Keep this Intent Node updated when modifying meta-tools. See root AGENTS.md for maintenance guidelines.*
