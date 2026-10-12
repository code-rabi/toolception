# Changelog

All notable changes to `toolception` are listed here. Versions follow [semver](https://semver.org/); while the major version is 0, a minor bump can contain breaking changes.

Releases before 0.7.0 are described in [GitHub Releases](https://github.com/code-rabi/toolception/releases).

## [Unreleased]

### Added

- `http.allowedOrigins` validates the `Origin` header on the `/mcp` endpoints, as the MCP spec requires. A request with an `Origin` outside the list gets `403`; requests without an `Origin` header are always allowed. When `cors` is on, only the listed origins get CORS access. Not set by default, so existing deployments behave as before.
  - **Migration:** none needed. To turn it on, pass `http: { allowedOrigins: ["https://app.example.com"] }`.

### Breaking

- `ServerOrchestrator.isReady()` now returns `false`, and `ensureReady()` throws, when registering a startup toolset's tools fails (for example a duplicate tool name, within a toolset or across toolsets when `namespaceToolsWithSetKey` is off). It used to report ready. As a result `createMcpServer` rejects at startup for such a catalog in STATIC mode, where it used to start with the partial toolset. Fix the catalog (rename or remove the duplicate tool) before upgrading. `enableToolset` results (and the `enable_toolset` meta-tool output) gain an optional `code` on that failure. Toolsets refused before registration (exposure policy, duplicate names in `startup.toolsets`) and module loader errors do not count as failures.

### Fixed

- A STATIC client whose startup toolsets fail to load now gets a JSON-RPC error (`-32603`, HTTP 500) on `initialize` instead of connecting with only some of its tools. The failed bundle is dropped, so the client's next `initialize` retries the load.

## [0.7.0]

### Breaking

- In STATIC mode every client now gets its own `McpServer` and orchestrator, like DYNAMIC mode. Module loaders run once per client instead of once per process, with each client's merged session context. ([#27](https://github.com/code-rabi/toolception/pull/27))
  - **Migration:** anything you register on the server returned by `createMcpServer` after it is created (prompts, resources, extra tools) no longer reaches STATIC clients. Register it inside your `createServer` factory instead, so every per-client server gets it.

### Fixed

- STATIC mode supports concurrent clients. Before, a second client's `initialize` closed the first client's connection, and its next request failed with `Session not found or expired`. ([#27](https://github.com/code-rabi/toolception/pull/27))
- Per-session context (`?config=`) now reaches module loaders in STATIC mode. ([#27](https://github.com/code-rabi/toolception/pull/27))
- Tools defined with a JSON Schema `inputSchema` load and receive their arguments on MCP SDK 1.28+, which rejects plain JSON Schema objects. ([#25](https://github.com/code-rabi/toolception/pull/25))

### Changed

- Now depends on `@modelcontextprotocol/sdk` `^1.32.1` and `fastify` `^5.12.5`. ([#25](https://github.com/code-rabi/toolception/pull/25))
- The `zod` dependency floor is now `^3.25`, matching the MCP SDK's peer range. ([#26](https://github.com/code-rabi/toolception/pull/26))
- Every tool, meta-tools included, registers through `McpServer.registerTool` instead of the deprecated `server.tool()` overloads. `annotations.title` is also sent as the tool's top-level `title`. ([#26](https://github.com/code-rabi/toolception/pull/26))
- JSON Schema inputs are accepted but not advertised to clients; use Zod shapes to advertise a tool's parameters. ([#25](https://github.com/code-rabi/toolception/pull/25), [#26](https://github.com/code-rabi/toolception/pull/26))

### Security

- Patched vulnerable dependencies: MCP SDK (GHSA-6qxp-vccf-f47h), fastify, and transitive packages (proxy-addr, hono, path-to-regexp, qs, fast-uri, ip-address). Dev tooling moved to vitest 5. ([#25](https://github.com/code-rabi/toolception/pull/25))
