# Core Module

## Purpose

Central orchestration layer that wires together all components. Manages toolset lifecycle, tool registration, and server initialization.

## Key Components

**ServerOrchestrator** (`ServerOrchestrator.ts`)
- Entry point combining ModuleResolver, DynamicToolManager, ToolRegistry
- `ensureReady()`: Async - waits for initialization, throws stored errors
- `isReady()`: Non-throwing alternative for health checks
- `getMode()`: Returns resolved DYNAMIC or STATIC mode
- `getManager()`: Access to DynamicToolManager

**DynamicToolManager** (`DynamicToolManager.ts`)
- `enableToolset(name, skipNotification?)`: Full validation + registration flow
- `disableToolset(name)`: State-only operation (see invariant #2)
- `enableToolsets(names)`: Batch enable with single notification
- `checkExposurePolicy(name)`: Validates against allowlist/denylist/maxActive
- `getStatus()`: Returns available/active toolsets, tools list, toolset→tools map

**ToolRegistry** (`ToolRegistry.ts`)
- `getSafeName(toolsetKey, toolName)`: Applies namespacing if enabled
- `has(name)`: Collision detection
- `add(name)` / `addForToolset(toolsetKey, name)`: Registration with collision check
- `mapAndValidate(toolsetKey, tools)`: Transforms tools with safe names, checks collisions

## Invariants

1. **All tools go through ToolRegistry** - Collision detection happens here only
2. **Disable is state-only** - MCP SDK cannot unregister tools; disabled toolsets' tools remain callable
3. **Notifications may fail silently** - "Not connected" errors are expected and swallowed
4. **Namespacing applied BEFORE collision check** - `mapAndValidate()` generates safe names first
5. **Toolset added to activeToolsets AFTER registration** - Partial failures leave toolset inactive

## Meta-tools Registration

Located in `src/meta/registerMetaTools.ts` (called by ServerOrchestrator):

**DYNAMIC mode only:**
- `enable_toolset` / `disable_toolset` - Runtime toolset management
- `list_toolsets` / `describe_toolset` - Discovery

**Both modes:**
- `list_tools` - List registered tool names

## Anti-patterns

- Bypassing ToolRegistry for tool registration (causes collision issues)
- Expecting disable to unregister tools from MCP (it can't)
- Throwing on notification failures (they're expected in SSE disconnect)

## Enable Toolset Flow

```
enableToolset(name)
  ↓
ModuleResolver.validateToolsetName(name)
  ↓
checkExposurePolicy(name) → fail fast if denied
  ↓
ModuleResolver.resolveToolsForToolsets([name], context)
  ↓
ToolRegistry.mapAndValidate(name, tools) → apply namespacing
  ↓
For each tool: registerSingleTool(tool, name)
  ↓
activeToolsets.add(name)
  ↓
notifyToolsChanged() (unless skipNotification)
```

## Dependencies

- Imports: `src/types`, `src/mode`, `src/meta`
- Used by: `src/server/*`, `src/http/*`

## See Also

- `src/mode/CLAUDE.md` - How tools are resolved
- `src/server/CLAUDE.md` - How orchestrator is created
- `src/types/CLAUDE.md` - ExposurePolicy, ToolingErrorCode

---
*Keep this Intent Node updated when modifying core orchestration. See root CLAUDE.md for maintenance guidelines.*
