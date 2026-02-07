# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Toolception is a dynamic MCP (Model Context Protocol) server toolkit for runtime toolset management. It allows grouping tools into toolsets and exposing only what's needed, when it's needed—reducing prompt/tool surface area for LLMs.

## Common Commands

```bash
# Build the library
npm run build

# Run in watch mode during development
npm run dev

# Type check without emitting
npm run typecheck

# Run all tests
npm run test

# Run tests once (no watch)
npm run test:run

# Run tests with coverage
npm run test:coverage

# Run a single test file
npx vitest run tests/toolRegistry.test.ts

# Run smoke tests (start server in one terminal, client in another)
npm run dev:server-demo
npm run dev:client-demo
```

## Intent Layer Navigation

Read the relevant Intent Node before working in that area:

- `src/types/AGENTS.md` - Type definitions and contracts
- `src/core/AGENTS.md` - ServerOrchestrator, DynamicToolManager, ToolRegistry
- `src/mode/AGENTS.md` - ModuleResolver, validation utilities
- `src/server/AGENTS.md` - createMcpServer, createPermissionBasedMcpServer
- `src/http/AGENTS.md` - FastifyTransport, endpoints, SSE
- `src/session/AGENTS.md` - SessionContextResolver, ClientResourceCache
- `src/permissions/AGENTS.md` - PermissionResolver, access control

### Maintaining the Intent Layer

**AI agents working in this codebase must keep Intent Nodes up to date.** When you:

- **Add a new invariant** → Document it in the relevant Intent Node
- **Change component behavior** → Update the affected Intent Node's description
- **Add new components** → Add them to the Key Components section
- **Discover an anti-pattern** → Add it to the Anti-patterns section
- **Create a new module** → Create a corresponding `AGENTS.md` Intent Node

Intent Nodes should remain concise (~100 lines max). Focus on what an agent needs to know to work safely in that area.

## Critical Invariants

1. **All tools → ToolRegistry** - Collision detection happens here only
2. **Disable ≠ Unregister** - MCP SDK limitation; disabled tools remain callable
3. **STATIC + sessionContext** - Session context ignored in STATIC mode
4. **Fail-secure** - Invalid inputs return empty objects, not errors
5. **Silent module failures** - Toolsets activate with partial tools if loaders fail

## Architecture

### Core Components

**ServerOrchestrator** (`src/core/ServerOrchestrator.ts`)
- Entry point that wires together all components
- Resolves startup mode (DYNAMIC vs STATIC) from configuration
- Creates ModuleResolver, DynamicToolManager, and ToolRegistry
- Registers meta-tools based on mode

**DynamicToolManager** (`src/core/DynamicToolManager.ts`)
- Manages toolset lifecycle (enable/disable)
- Enforces exposure policies (allowlist, denylist, maxActiveToolsets)
- Registers tools with the MCP server
- Tracks active toolsets and sends change notifications

**ToolRegistry** (`src/core/ToolRegistry.ts`)
- Central registry preventing tool name collisions
- Handles namespacing (e.g., `toolset.toolname`)
- Maps toolsets to their registered tools

**ModuleResolver** (`src/mode/ModuleResolver.ts`)
- Resolves tools from toolset definitions
- Loads module-produced tools via moduleLoaders
- Validates toolset names against catalog

### Server Creation APIs

Two main factory functions in `src/server/`:
- `createMcpServer` - Standard server with DYNAMIC or STATIC modes
- `createPermissionBasedMcpServer` - Per-client toolset access control

### HTTP Transport

**FastifyTransport** (`src/http/FastifyTransport.ts`)
- Fastify-based HTTP transport for MCP protocol
- Handles SSE streams, JSON-RPC requests
- Per-client server instances in DYNAMIC mode

**PermissionAwareFastifyTransport** (`src/http/PermissionAwareFastifyTransport.ts`)
- Extends FastifyTransport with permission checking
- Supports header-based or config-based permissions

### Session Context

**SessionContextResolver** (`src/session/SessionContextResolver.ts`)
- Parses query parameter (base64/json encoding)
- Filters allowed keys (whitelist enforcement)
- Merges session context with base context (shallow or deep)
- Generates cache key suffix for session differentiation

### Key Types (`src/types/index.ts`)

- `McpToolDefinition` - Tool with name, description, inputSchema, handler, optional annotations
- `ToolSetDefinition` - Groups tools with name, description, optional modules
- `ToolSetCatalog` - Record of toolset key to definition
- `ExposurePolicy` - Controls maxActiveToolsets, allowlist, denylist, namespacing
- `PermissionConfig` - Header or config-based permission source
- `SessionContextConfig` - Per-session context configuration (query params, encoding, merge strategy)
- `SessionRequestContext` - Request context (clientId, headers, query) for context resolvers

### Meta-tools (DYNAMIC mode)

Registered in `src/meta/registerMetaTools.ts`:
- `enable_toolset` / `disable_toolset` - Activate/deactivate toolsets
- `list_toolsets` / `describe_toolset` - Discovery
- `list_tools` - List currently registered tools

## Testing Patterns

Tests use Vitest with in-memory mocks. Key patterns:
- Fake MCP server in `tests/helpers/fakes.ts`
- Unit tests alongside integration tests in `tests/`
- E2E tests in `tests/e2e/` for full server/client flows
- Smoke E2E tests in `tests/smoke-e2e/` for manual server/client testing

### Key Test Files

- `tests/sessionContextResolver.test.ts` - Unit tests for SessionContextResolver (parsing, filtering, merging)
- `tests/validateSessionContextConfig.test.ts` - Validation tests for SessionContextConfig
- `tests/sessionContext.integration.test.ts` - Integration tests for session context with HTTP transport
- `tests/e2e/dynamicMode.e2e.test.ts` - E2E tests for DYNAMIC mode and session context
- `tests/e2e/staticMode.e2e.test.ts` - E2E tests for STATIC mode
- `tests/e2e/permissionBased.e2e.test.ts` - E2E tests for permission-based servers

## Build System

- Vite for bundling (`vite.config.ts`)
- vite-plugin-dts for TypeScript declarations
- ESM-only output (`"type": "module"`)
- Node.js >= 25.3.0 required
