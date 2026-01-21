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

### Key Types (`src/types/index.ts`)

- `McpToolDefinition` - Tool with name, description, inputSchema, handler, optional annotations
- `ToolSetDefinition` - Groups tools with name, description, optional modules
- `ToolSetCatalog` - Record of toolset key to definition
- `ExposurePolicy` - Controls maxActiveToolsets, allowlist, denylist, namespacing
- `PermissionConfig` - Header or config-based permission source

### Meta-tools (DYNAMIC mode)

Registered in `src/meta/registerMetaTools.ts`:
- `enable_toolset` / `disable_toolset` - Activate/deactivate toolsets
- `list_toolsets` / `describe_toolset` - Discovery
- `list_tools` - List currently registered tools

## Testing Patterns

Tests use Vitest with in-memory mocks. Key patterns:
- Fake MCP server in `tests/helpers/fakes.ts`
- Unit tests alongside integration tests in `tests/`
- Smoke E2E tests in `tests/smoke-e2e/` for manual server/client testing

## Build System

- Vite for bundling (`vite.config.ts`)
- vite-plugin-dts for TypeScript declarations
- ESM-only output (`"type": "module"`)
- Node.js >= 25.3.0 required
