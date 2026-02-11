# Types Module

## Purpose

Defines all TypeScript interfaces, types, and contracts. Foundation layer with no internal dependencies.

## Key Types

- **McpToolDefinition** — Individual tool: name, description, inputSchema, handler, optional annotations
- **ToolSetDefinition** — Groups tools with optional module references and decision criteria for LLMs
- **ToolSetCatalog** — `Record<string, ToolSetDefinition>` mapping toolset keys to definitions
- **ExposurePolicy** — Controls toolset access: allowlist/denylist, max active count, namespacing
- **PermissionConfig** — Per-client access control with header or config source
- **SessionContextConfig** — Per-session context extraction from query params
- **ToolingErrorCode** — Error classification: `E_VALIDATION`, `E_POLICY_MAX_ACTIVE`, `E_TOOL_NAME_CONFLICT`, `E_NOTIFY_FAILED`, `E_INTERNAL`
- **ModuleLoader** — `(context?) => Promise<McpToolDefinition[]> | McpToolDefinition[]`

Also: `src/errors/ToolingError.ts` (18 LOC) — thin error class wrapping ToolingErrorCode. No separate Intent Node needed.

## Invariants

1. **Annotations must be non-empty objects or omitted** — Empty `{}` annotations cause SDK issues; omit entirely if unused
2. **ToolingErrorCode values are exhaustive** — All error codes defined here; do not add codes elsewhere
3. **PermissionConfig requires source field** — Must specify `"headers"` or `"config"`
4. **SessionContextConfig.allowedKeys is security-critical** — Always whitelist allowed keys; omitting allows arbitrary config injection

## Anti-patterns

- Adding tool validation logic here (belongs in ToolRegistry)
- Importing from other `src/` modules (types is leaf-level)
- Making types mutable (all should be readonly where possible)

---
*Keep this Intent Node updated when modifying types. See root AGENTS.md for maintenance guidelines.*
