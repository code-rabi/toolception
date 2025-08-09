# E2E Local Tests

This directory contains a runnable MCP server and shell scripts to test it locally using curl.

## Start the server

- Using npm script:
  ```bash
  npm run dev:server-demo
  ```
- Or directly with tsx:
  ```bash
  npx --yes tsx tests/e2e-local/server-demo.ts
  ```
- Optional: override port
  ```bash
  PORT=3100 npm run dev:server-demo
  # or
  PORT=3100 npx --yes tsx tests/e2e-local/server-demo.ts
  ```

## Run tests

Open a new terminal while the server is running.

- HTTP endpoints test:
  ```bash
  bash tests/e2e-local/test-http.sh
  ```
- MCP flow test:
  ```bash
  bash tests/e2e-local/test-mcp.sh
  ```

Logs:

- `tests/e2e-local/test-http.log`
- `tests/e2e-local/test-mcp.log`

## What is covered

- Health, config schema, tool listing, error handling on POST /mcp without body
- JSON-RPC initialize, list_tools, enable core toolset, core.ping, session DELETE
