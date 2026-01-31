# Mode Module

## Purpose

Handles toolset resolution, validation, and startup mode determination. Provides the bridge between toolset definitions and tool instances.

## Key Components

**ModuleResolver** (`ModuleResolver.ts`)
- `getAvailableToolsets()`: Returns all toolset keys from catalog
- `getToolsetDefinition(name)`: Retrieves single toolset definition
- `validateToolsetName(name)`: Returns `{isValid, sanitized, error}`
- `resolveToolsForToolsets(toolsets, context)`: Async - collects direct tools + module-loaded tools

**ToolsetValidator** (`ModeResolver.ts`)
- `resolveMode(env?, args?)`: Returns "DYNAMIC", "STATIC", or null
- `validateToolsetName(name, catalog)`: Validates against provided catalog
- `parseCommaSeparatedToolSets(input, catalog)`: Parses toolset strings
- `validateToolsetModules(toolsetNames, catalog)`: Returns modules for valid toolsets

## Invariants

1. **Module loaders fail silently** - Errors are caught, logged as warnings, and skipped; toolset activates with partial tools
2. **ToolsetValidator is in ModeResolver.ts** - Historical naming quirk: `ToolsetValidator.ts` just re-exports from `ModeResolver.ts`
3. **ModuleResolver stores catalog; ToolsetValidator takes it as parameter** - Different validation signatures
4. **Context passed to module loaders** - Enables dynamic tool generation based on runtime context

## Anti-patterns

- Throwing on invalid toolset names (return validation result instead)
- Assuming module loaders are synchronous (always await)
- Using ToolsetValidator.ts directly (it's just a re-export)

## Module Loading Flow

```
resolveToolsForToolsets([toolsetName], context)
  ↓
For each toolset:
  1. Collect direct tools from definition.tools[]
  2. For each module in definition.modules[]:
     - Look up loader in moduleLoaders map
     - Call loader(context) - may be async
     - Catch errors → warn and skip
     - Append returned tools
  ↓
Return flattened McpToolDefinition[]
```

## Dependencies

- Imports: `src/types`
- Used by: `src/core/ServerOrchestrator`, `src/core/DynamicToolManager`

## See Also

- `src/core/CLAUDE.md` - How resolved tools are registered
- `src/types/CLAUDE.md` - ModuleLoader type definition

---
*Keep this Intent Node updated when modifying mode resolution. See root CLAUDE.md for maintenance guidelines.*
