# E2E Smoke Tests

This directory contains runnable MCP servers and clients to smoke-test the HTTP/SSE transport, tool flows, and permission-based access control.

## Standard Server/Client Tests

### Start the server

- Using npm script:
  ```bash
  npm run dev:server-demo
  ```
- Run in STATIC mode (preload ALL toolsets):
  ```bash
  STARTUP_MODE=STATIC TOOLSETS=ALL npm run dev:server-demo
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

### Run client

Open a new terminal while the server is running.

```bash
npm run dev:client-demo
# Optional overrides
PORT=3003 MCP_CLIENT_ID=my-stable-client-id npm run dev:client-demo
```

## Permission-Based Access Control Tests

### Header-Based Permissions

Test server that reads permissions from request headers.

**Start the server:**

```bash
npx --yes tsx tests/smoke-e2e/permission-header-server-demo.ts
# Optional: override port
PORT=3004 npx --yes tsx tests/smoke-e2e/permission-header-server-demo.ts
```

**Run the client tests:**

```bash
npx --yes tsx tests/smoke-e2e/permission-header-client-demo.ts
# Optional: override port
PORT=3004 npx --yes tsx tests/smoke-e2e/permission-header-client-demo.ts
```

The client tests multiple scenarios:

- Client with math and text permissions
- Client with only data permissions
- Client with all permissions
- Client with no permissions

### Config-Based Permissions

Test server that uses server-side permission configuration with static maps and resolver functions.

**Start the server:**

```bash
npx --yes tsx tests/smoke-e2e/permission-config-server-demo.ts
# Optional: override port
PORT=3005 npx --yes tsx tests/smoke-e2e/permission-config-server-demo.ts
```

**Run the client tests:**

```bash
npx --yes tsx tests/smoke-e2e/permission-config-client-demo.ts
# Optional: override port
PORT=3005 npx --yes tsx tests/smoke-e2e/permission-config-client-demo.ts
```

The client tests multiple scenarios:

- Known clients from static map (admin-user, regular-user, analyst-user)
- Dynamic clients matching resolver patterns (admin-_, analyst-_, user-\*)
- Unknown clients receiving default permissions
