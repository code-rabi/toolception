# Types Module

## Purpose

Defines all TypeScript interfaces, types, and contracts for the Toolception system. This is the foundation layer with no internal dependencies.

## Key Components

**McpToolDefinition** - Individual tool structure with name, description, inputSchema, handler, and optional annotations.

**ToolSetDefinition** - Groups tools into named sets with optional module references and decision criteria.

**ToolSetCatalog** - `Record<string, ToolSetDefinition>` mapping toolset keys to definitions.

**ExposurePolicy** - Controls toolset access:
- `maxActiveToolsets`: Concurrent limit
- `allowlist` / `denylist`: Toolset filtering
- `namespaceToolsWithSetKey`: Prefix tools with toolset name
- `onLimitExceeded`: Callback when limit hit

**PermissionConfig** - Per-client access control:
- `source: "headers" | "config"` - Permission data source
- `headerName`: Custom header (default: `mcp-toolset-permissions`)
- `staticMap`: clientId → toolsets mapping
- `resolver`: Dynamic permission function
- `defaultPermissions`: Fallback array

**SessionContextConfig** - Per-session context extraction:
- `queryParam`: name, encoding (base64/json), allowedKeys
- `contextResolver`: Custom context builder
- `merge`: "shallow" | "deep"

**ToolingErrorCode** - Error classification enum:
- `E_VALIDATION`, `E_POLICY_MAX_ACTIVE`, `E_TOOL_NAME_CONFLICT`, `E_NOTIFY_FAILED`, `E_INTERNAL`

**ModuleLoader** - `(context?) => Promise<McpToolDefinition[]> | McpToolDefinition[]`

## Invariants

1. **Annotations must be non-empty objects or omitted** - Empty `{}` annotations cause issues; omit entirely if unused
2. **ToolingErrorCode values are exhaustive** - All error codes are defined here; do not add codes elsewhere
3. **PermissionConfig requires source field** - Must specify "headers" or "config"
4. **SessionContextConfig.allowedKeys is security-critical** - Always whitelist allowed keys

## Anti-patterns

- Adding tool validation logic here (belongs in ToolRegistry)
- Importing from other src/ modules (types is leaf-level)
- Making types mutable (all should be readonly where possible)

## Dependencies

- Imports: None (leaf module)
- Used by: All other modules

## See Also

- `src/errors/ToolingError.ts` - Error class using ToolingErrorCode (18 LOC)
- `src/core/CLAUDE.md` - How types are used in orchestration

---
*Keep this Intent Node updated when modifying types. See root CLAUDE.md for maintenance guidelines.*
