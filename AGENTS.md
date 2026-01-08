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

## HTTP endpoints

### Built-in MCP endpoints

- `GET /healthz` - Health check
- `GET /tools` - List available toolsets and tools
- `POST /mcp` - MCP JSON-RPC requests
- `GET /mcp` - Server-sent events stream
- `DELETE /mcp` - Close session
- `GET /.well-known/mcp-config` - Configuration schema

### Custom HTTP endpoints

Servers may expose custom REST-like endpoints alongside MCP protocol endpoints. These are defined by the server implementer and provide direct HTTP access to functionality.

- Custom endpoints use standard HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Request/response validation via Zod schemas
- Access to client ID via `mcp-client-id` header
- Permission-aware endpoints receive client's allowed toolsets
- Standard error format with `VALIDATION_ERROR`, `INTERNAL_ERROR`, or `RESPONSE_VALIDATION_ERROR` codes

Check `GET /tools` or server documentation to discover available custom endpoints.

### Headers

- `mcp-client-id`: Client identifier (reuse for per-client sessions)
- `mcp-session-id`: Session identifier (managed by MCP transport after initialize)
- `mcp-toolset-permissions`: Comma-separated toolset list (permission-based servers with header-based permissions)
