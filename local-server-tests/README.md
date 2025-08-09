# Local Server Tests

This directory contains a runnable MCP server and shell scripts to test it locally using curl.

## Prerequisites

- Node.js >= 20
- bash and curl available in your shell

## Start the server

- Using npm script:
  ```bash
  npm run dev:server-demo
  ```
- Or directly with tsx:
  ```bash
  npx --yes tsx local-server-tests/server-demo.ts
  ```
- Optional: override port
  ```bash
  PORT=3100 npm run dev:server-demo
  # or
  PORT=3100 npx --yes tsx local-server-tests/server-demo.ts
  ```

The server exposes:

- GET `/healthz`
- GET `/tools`
- GET `/.well-known/mcp-config`
- POST `/mcp` (JSON-RPC)
- GET `/mcp` (SSE)
- DELETE `/mcp` (terminate session)

## Run tests

Open a new terminal while the server is running.

- HTTP endpoints test:
  ```bash
  bash local-server-tests/test-http.sh
  ```
- MCP flow test:
  ```bash
  bash local-server-tests/test-mcp.sh
  ```

Both scripts write logs to:

- `local-server-tests/test-http.log`
- `local-server-tests/test-mcp.log`

You can override the port used by the scripts:

```bash
PORT=3100 bash local-server-tests/test-http.sh
PORT=3100 bash local-server-tests/test-mcp.sh
```

## What the tests do

- HTTP test
  - Verifies `/healthz` returns `{ ok: true }`
  - Verifies `/.well-known/mcp-config` returns a JSON Schema object
  - Verifies `/tools` returns toolset metadata
  - Verifies `POST /mcp` without a body returns HTTP 400
- MCP test
  - Initializes a session with `POST /mcp` using JSON-RPC `initialize`
  - Extracts `mcp-session-id` from response headers
  - Calls the `list_tools` meta-tool
  - Calls the `core.ping` tool and expects a `pong` response in content
  - Terminates the session via `DELETE /mcp`

## Example curl payloads

- Initialize (starts a session; server will return an `mcp-session-id` header):
  ```bash
  curl -sS -D - -H 'Content-Type: application/json' -H 'mcp-client-id: demo' \
    -X POST http://localhost:3003/mcp \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}'
  ```
- Call a tool (requires both `mcp-client-id` and `mcp-session-id` headers):
  ```bash
  curl -sS -H 'Content-Type: application/json' -H 'mcp-client-id: demo' -H 'mcp-session-id: <SESSION_ID>' \
    -X POST http://localhost:3003/mcp \
    --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"core.ping","arguments":{}}}'
  ```
- End session:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' -H 'mcp-client-id: demo' -H 'mcp-session-id: <SESSION_ID>' -X DELETE http://localhost:3003/mcp
  ```

## Troubleshooting

- If the scripts fail, inspect the log files listed above.
- Ensure nothing else is listening on the chosen port.
- Confirm your Node version is >= 20: `node -v`.
- If running scripts directly, make sure to invoke with `bash` (or `chmod +x` and run `./...`).
