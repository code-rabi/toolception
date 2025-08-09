# Using Toolception with Agents/LLMs

## Capabilities by mode

- Dynamic mode:
  - Meta-tools available: `enable_toolset`, `disable_toolset`, `list_toolsets`, `describe_toolset`, and `list_tools`.
  - Tools may change at runtime; server advertises `tools.listChanged` capability.
- Static mode:
  - Meta-tools available: `list_tools` only. Do not attempt to enable/disable toolsets.

## Recommended agent flow

1. Discover current tools
   - Always call `list_tools()` first. Response includes `tools` and `toolsetToTools`.
2. (Dynamic only) Discover available toolsets
   - If `list_toolsets` is present, call it to see all toolsets, their definitions, and which are active.
3. (Dynamic only) Enable toolsets on demand
   - Call `enable_toolset({ name })` for a specific toolset. Handle failures:
     - Not allowed/denied by policy
     - Already active
     - Max active toolsets exceeded
4. Invoke task-specific tools using namespaced names (e.g., `search.find`).
5. (Optional) Disable toolsets no longer needed via `disable_toolset({ name })` (state-only).

## Tool naming

- Tools are namespaced by toolset (e.g., `search.find`) to avoid collisions.
- Namespace policy may be customized; default is ON.

## Error handling cues

- Meta-tools return JSON with `success` and `message` fields. Read `message` to adapt decisions (e.g., policy denial, already active, limits exceeded).

## HTTP (debugging only)

- Endpoints: `GET /healthz`, `GET /tools`, `POST/GET/DELETE /mcp`, `GET /.well-known/mcp-config`.
- Headers: use `mcp-client-id` to reuse per-client server bundles; `mcp-session-id` is managed by the MCP transport after initialize.
