# Toolception — Intent Layer Root

## What This Is

Dynamic MCP server toolkit for runtime toolset management. Groups tools into toolsets, exposes only what's needed — reducing prompt/tool surface area for LLMs.

## Architecture

```
src/
├── types/          # Contracts (leaf — no deps)
├── core/           # ServerOrchestrator, DynamicToolManager, ToolRegistry
├── mode/           # ModuleResolver, toolset validation
├── meta/           # Meta-tool registration (enable/disable/list)
├── server/         # createMcpServer, createPermissionBasedMcpServer
├── http/           # FastifyTransport, custom endpoints
├── session/        # SessionContextResolver, ClientResourceCache
├── permissions/    # PermissionResolver, PermissionAwareFastifyTransport
└── errors/         # ToolingError (18 LOC, thin wrapper — no Intent Node)
```

### Two Server Modes

| | DYNAMIC | STATIC |
|---|---|---|
| Toolsets | Enabled at runtime via meta-tools | Pre-loaded at startup |
| Server instances | Per-client | Shared singleton |
| Meta-tools | All 5 registered | `list_tools` only |
| Use case | Task-specific, lazy loading | Fixed pipelines |

### Permission-Based Variant

`createPermissionBasedMcpServer` — per-client STATIC servers with access control. Permissions resolved from headers or server config. No meta-tools.

## Code Style

1. **No non-null assertions (`!`)** — Guard before use or use conditional builder calls. Never use `!` to silence the compiler.
2. **No `as any` in production code** — Permitted only for defensive runtime guards and SDK boundary mismatches. Every `as any` should have a comment justifying it.
3. **Named functions over anonymous callbacks** — Extract inline closures longer than ~5 lines into named functions with JSDoc.
4. **Builder pattern: conditional calls for optional fields** — Call builder methods conditionally (`if (value) { builder.method(value); }`) rather than asserting.
5. **Prefer `builder()` over raw constructors** — When a class exposes a builder, use it.
6. **Named intermediate variables** — Assign computed values to descriptively-named `const` variables before passing them onward.

## Critical Invariants

These are cross-cutting; see leaf Intent Nodes for module-specific invariants.

1. **All tools → ToolRegistry** — Collision detection happens here only
2. **`mcp-client-id` required for /mcp** — POST, GET, DELETE all reject without header (400)
3. **Fail-secure** — Invalid inputs return empty objects/arrays, not errors
4. **Silent module failures** — Toolsets activate with partial tools if loaders fail
5. **Disable is state-only** — MCP SDK has no tool unregister; see `src/core/AGENTS.md`

## Module Index

Read the relevant Intent Node before working in that area:

| Module | Intent Node | Covers |
|--------|-------------|--------|
| Types | `src/types/AGENTS.md` | Interfaces, contracts, error codes |
| Core | `src/core/AGENTS.md` | ServerOrchestrator, DynamicToolManager, ToolRegistry |
| Meta | `src/meta/AGENTS.md` | Meta-tool registration, `_meta` reserved key |
| Mode | `src/mode/AGENTS.md` | ModuleResolver, toolset validation |
| Server | `src/server/AGENTS.md` | createMcpServer, createPermissionBasedMcpServer |
| HTTP | `src/http/AGENTS.md` | FastifyTransport, endpoints, SSE, custom endpoints |
| Session | `src/session/AGENTS.md` | SessionContextResolver, ClientResourceCache |
| Permissions | `src/permissions/AGENTS.md` | PermissionResolver, PermissionAwareFastifyTransport |

## Maintaining Intent Nodes

**AI agents working in this codebase must keep Intent Nodes up to date.** When you:

- **Add a new invariant** → Document it in the relevant Intent Node
- **Change component behavior** → Update the affected Intent Node
- **Add new components** → Add to Key Components section
- **Discover an anti-pattern** → Add to Anti-patterns section
- **Create a new module** → Create a corresponding `AGENTS.md`

Intent Nodes should remain concise (~100 lines max). Focus on what an agent needs to work safely in that area — hidden knowledge that cannot be derived by reading the source code.

---
*This is the Intent Layer root. See leaf nodes for module-specific detail.*
