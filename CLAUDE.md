# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Toolception is a dynamic MCP (Model Context Protocol) server toolkit for runtime toolset management. It allows grouping tools into toolsets and exposing only what's needed, when it's needed—reducing prompt/tool surface area for LLMs.

## Architecture & Intent Layer

**Start with `AGENTS.md`** — the intent layer root. It provides the architectural overview, critical invariants, module index, and links to module-specific Intent Nodes.

Read the relevant Intent Node before working in any area of the codebase.

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

## Testing Patterns

Tests use Vitest with in-memory mocks. Key patterns:
- Fake MCP server in `tests/helpers/fakes.ts`
- Unit tests alongside integration tests in `tests/`
- E2E tests in `tests/e2e/` for full server/client flows
- Smoke E2E tests in `tests/smoke-e2e/` for manual server/client testing

### Key Test Files

- `tests/sessionContextResolver.test.ts` - Unit tests for SessionContextResolver
- `tests/validateSessionContextConfig.test.ts` - Validation tests for SessionContextConfig
- `tests/sessionContext.integration.test.ts` - Integration tests for session context
- `tests/e2e/dynamicMode.e2e.test.ts` - E2E tests for DYNAMIC mode
- `tests/e2e/staticMode.e2e.test.ts` - E2E tests for STATIC mode
- `tests/e2e/permissionBased.e2e.test.ts` - E2E tests for permission-based servers

## Build System

- Vite for bundling (`vite.config.ts`)
- vite-plugin-dts for TypeScript declarations
- ESM-only output (`"type": "module"`)
- Node.js >= 25.3.0 required
