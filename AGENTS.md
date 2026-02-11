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
└── errors/         # ToolingError (18 LOC)
```

### Data Flow

```
Client → HTTP (Fastify) → Per-client MCP Server → ServerOrchestrator
                                                     ↓
                                           DynamicToolManager
                                              ↓           ↓
                                    ModuleResolver    ToolRegistry
                                         ↓
                                    ModuleLoaders(context)
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

## Critical Invariants

1. **All tools → ToolRegistry** — Collision detection happens here only
2. **Disable ≠ Unregister** — MCP SDK limitation; disabled tools remain callable
3. **STATIC + sessionContext** — Session context ignored in STATIC mode
4. **Fail-secure** — Invalid inputs return empty objects, not errors
5. **Silent module failures** — Toolsets activate with partial tools if loaders fail
6. **`mcp-client-id` required for /mcp** — POST, GET, DELETE all reject without header (400)

## Module Index

Read the relevant Intent Node before working in that area:

| Module | Intent Node | Covers |
|--------|-------------|--------|
| Types | `src/types/AGENTS.md` | All interfaces, contracts, error codes |
| Core | `src/core/AGENTS.md` | ServerOrchestrator, DynamicToolManager, ToolRegistry |
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

Intent Nodes should remain concise (~100 lines max). Focus on what an agent needs to work safely in that area.

## Consumer Reference

For agents/LLMs **using** Toolception tools at runtime (not developing the codebase):

### Meta-tools (DYNAMIC mode)

- `list_tools()` → `{tools, toolsetToTools}` — Always call first
- `list_toolsets()` → Discover available toolsets
- `enable_toolset({name})` / `disable_toolset({name})` — Runtime control
- `describe_toolset({name})` → Toolset details

Tools are namespaced by toolset (e.g., `search.find`). Error responses include `{success, message}`.

### HTTP Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | Health check |
| GET | `/tools` | Tool/toolset status |
| POST | `/mcp` | JSON-RPC (requires `mcp-client-id`) |
| GET | `/mcp` | SSE stream (requires `mcp-client-id`) |
| DELETE | `/mcp` | Close session (requires `mcp-client-id`) |
| GET | `/.well-known/mcp-config` | Config schema |

### Headers

- `mcp-client-id`: **Required** for `/mcp` endpoints. Stable client identifier.
- `mcp-session-id`: Session ID from server (managed by transport after initialize)
- `mcp-toolset-permissions`: Comma-separated toolsets (permission-based, header source)
- `config` query param: Base64-encoded JSON for per-session context (if enabled)

---
*This is the Intent Layer root. See leaf nodes for module-specific detail.*
