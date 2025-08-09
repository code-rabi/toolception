# E2E Smoke Tests

This directory contains a runnable MCP server and client to smoke-test the HTTP/SSE transport and tool flows.

## Start the server

- Using npm script:
  ```bash
  npm run dev:server-demo
  ```
- Or directly with tsx:
  ```bash
  npx --yes tsx tests/smoke-e2e/server-demo.ts
  ```
- Optional: override port
  ```bash
  PORT=3100 npm run dev:server-demo
  # or
  PORT=3100 npx --yes tsx tests/smoke-e2e/server-demo.ts
  ```

## Run client

Open a new terminal while the server is running.

```bash
npm run dev:client-demo
# Optional overrides
PORT=3003 MCP_CLIENT_ID=my-stable-client-id npm run dev:client-demo
```
