# Toolception – Dynamic MCP Tooling Library

[![npm version](https://img.shields.io/npm/v/toolception.svg)](https://www.npmjs.com/package/toolception)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Table of Contents

- [When and why to use Toolception](#when-and-why-to-use-toolception)
- [Starter guide](#starter-guide)
- [Static startup](#static-startup)
- [Permission-based starter guide](#permission-based-starter-guide)
- [Permission configuration approaches](#permission-configuration-approaches)
- [Custom HTTP endpoints](#custom-http-endpoints)
- [Per-session context](#per-session-context)
- [API](#api)
  - [createMcpServer](#createmcpserveroptions)
  - [createPermissionBasedMcpServer](#createpermissionbasedmcpserveroptions)
- [Permission-based client integration](#permission-based-client-integration)
- [Permission-based security best practices](#permission-based-security-best-practices)
- [Permission-based common patterns](#permission-based-common-patterns)
- [Client ID lifecycle](#client-id-lifecycle)
- [Session ID lifecycle](#session-id-lifecycle)
- [Tool types](#tool-types)
- [Startup modes](#startup-modes)
- [License](#license)

## When and why to use Toolception

Building MCP servers with dozens or hundreds of tools often harms LLM performance and developer experience:

- **Too many tools overwhelm selection**: Larger tool lists increase confusion and mis-selection rates.
- **Token and schema bloat**: Long tool catalogs inflate prompts and latency.
- **Name collisions and ambiguity**: Similar tool names across domains cause failures and fragile integrations.
- **Operational overhead**: Loading every tool up-front wastes resources; many tools are task-specific.

Toolception addresses this by grouping tools into toolsets and letting you expose only what’s needed, when it’s needed.

### When to use Toolception

- **Large or multi-domain catalogs**: You have >20–50 tools or multiple domains (e.g., search, data, billing) and don’t want to expose them all at once.
- **Task-specific workflows**: You want the client/agent to enable only the tools relevant to the current task.
- **Multi-tenant or policy needs**: Different users/tenants require different tool access or limits.
- **Per-session context**: You need different context values (API tokens, user IDs) for each client session passed to module loaders.
- **Permission-based access control**: You need to enforce client-specific toolset permissions for security, compliance, or multi-tenant isolation. Each client should only see and access the toolsets they're authorized to use, with server-side or header-based permission enforcement.
- **Collision-safe naming**: You need predictable, namespaced tool names to avoid conflicts.
- **Lazy loading**: Some tools are heavy and should be loaded on demand.

### Why Toolception helps

- **Toolsets**: Group related tools and expose minimal, coherent subsets per task.
- **Dynamic mode (runtime control)**:
  - Enable toolsets on demand via meta-tools (`enable_toolset`, `disable_toolset`, `list_toolsets`, `describe_toolset`, `list_tools`).
  - Reduce prompt/tool surface area → better tool selection and lower latency.
  - Lazy-load module-produced tools only when needed; pass shared `context` safely to loaders.
  - Supports `tools.listChanged` notifications so clients can react to updated tool lists.
- **Static mode (predictable startup)**:
  - Preload known toolsets (or ALL) at startup for fixed pipelines and simpler environments.
  - Keep only the required sets for your deployment footprint.
- **Exposure policy**:
  - **maxActiveToolsets**: Cap concurrently active sets to prevent bloat.
  - **allowlist/denylist**: Enforce which toolsets can be enabled.
  - **namespaceToolsWithSetKey**: Default on; registers tools as `set.tool` to avoid collisions and clarify intent.
- **Operational safety**:
  - Central `ToolRegistry` validates names and prevents collisions.
  - `ModuleLoaders` are deterministic/idempotent for repeatable runs and caching.

### Choosing a mode

- **Prefer DYNAMIC** when tool needs vary by task, you want tighter prompts, or you need runtime gating and lazy loading.
- **Choose STATIC** when your tool needs are stable and small, or when your client cannot (or should not) perform runtime enable/disable operations.

### Typical flows

- **Discovery-first (dynamic)**: Client calls `list_toolsets` → enables a set → calls namespaced tools (e.g., `core.ping`).
- **Fixed pipeline (static)**: Server preloads named toolsets (or ALL) at startup; clients call `list_tools` and invoke as usual.

## Starter guide

### Step 1: Install

```bash
npm i toolception
```

### Step 2: Import Toolception

```ts
import { createMcpServer } from "toolception";
```

### Step 3: Define a toolset catalog

```ts
const catalog = {
  quotes: { name: "Quotes", description: "Market quotes", modules: ["quotes"] },
};
```

### Step 4: Define a tool

```ts
const quoteTool = {
  name: "price",
  description: "Return a fake price",
  inputSchema: {
    type: "object",
    properties: { symbol: { type: "string" } },
    required: ["symbol"],
  },
  handler: async ({ symbol }: { symbol: string }) => ({
    content: [{ type: "text", text: `${symbol}: 123.45` }],
  }),
} as const;
```

### Step 5: Provide module loaders

```ts
const moduleLoaders = {
  quotes: async () => [quoteTool],
};
```

### Step 6: (Optional) Configuration schema

```ts
const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    REQUIRED_PARAM: { type: "string", title: "Required Param" },
    OPTIONAL_PARAM: { type: "string", title: "Optional Param" },
  },
  required: ["REQUIRED_PARAM"],
} as const;
```

### Step 7: Create the MCP SDK server and start Toolception

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// You own the SDK server; pass a factory into Toolception (required in DYNAMIC mode)
const createServer = () =>
  new McpServer({
    name: "my-mcp-server",
    version: "0.0.0",
    capabilities: { tools: { listChanged: true } },
  });

const { start, close } = await createMcpServer({
  catalog,
  moduleLoaders,
  startup: { mode: "DYNAMIC" },
  http: { port: 3000 },
  createServer,
  // configSchema, // uncomment to expose at /.well-known/mcp-config
});
await start();
```

### Step 8: Graceful shutdown

```ts
process.on("SIGINT", async () => {
  await close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await close();
  process.exit(0);
});
```

## Static startup

Enable some or ALL toolsets at bootstrap. In STATIC mode, a single server instance is created and reused for all clients:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const staticCatalog = {
  search: { name: "Search", description: "Search tools", modules: ["search"] },
  quotes: { name: "Quotes", description: "Market quotes", modules: ["quotes"] },
};

// Load specific toolsets
createMcpServer({
  catalog: staticCatalog,
  startup: { mode: "STATIC", toolsets: ["search", "quotes"] },
  http: { port: 3001 },
  createServer: () =>
    new McpServer({
      name: "static-1",
      version: "0.0.0",
      capabilities: { tools: { listChanged: false } },
    }),
});

// Load ALL toolsets
createMcpServer({
  catalog: staticCatalog,
  startup: { mode: "STATIC", toolsets: "ALL" },
  http: { port: 3002 },
  createServer: () =>
    new McpServer({
      name: "static-2",
      version: "0.0.0",
      capabilities: { tools: { listChanged: false } },
    }),
});
```

## Permission-based starter guide

Use `createPermissionBasedMcpServer` when you need to enforce client-specific toolset permissions. This is ideal for multi-tenant applications, security-sensitive environments, or when different clients should have different levels of access.

### Step 1: Install

```bash
npm i toolception
```

### Step 2: Import Toolception

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
```

### Step 3: Define a toolset catalog

```ts
const catalog = {
  admin: {
    name: "Admin Tools",
    description: "Administrative operations",
    modules: ["admin"],
  },
  user: {
    name: "User Tools",
    description: "Standard user operations",
    modules: ["user"],
  },
};
```

### Step 4: Define tools

```ts
const adminTool = {
  name: "delete_user",
  description: "Delete a user account",
  inputSchema: {
    type: "object",
    properties: {
      userId: { type: "string", description: "User ID to delete" },
    },
    required: ["userId"],
  },
  handler: async ({ userId }: { userId: string }) => ({
    content: [{ type: "text", text: `User ${userId} deleted` }],
  }),
} as const;

const userTool = {
  name: "get_profile",
  description: "Get user profile information",
  inputSchema: {
    type: "object",
    properties: {
      userId: { type: "string", description: "User ID" },
    },
    required: ["userId"],
  },
  handler: async ({ userId }: { userId: string }) => ({
    content: [{ type: "text", text: `Profile for ${userId}: {...}` }],
  }),
} as const;
```

### Step 5: Provide module loaders

```ts
const moduleLoaders = {
  admin: async () => [adminTool],
  user: async () => [userTool],
};
```

### Step 6: Choose permission approach

You have two options for managing permissions:

**Header-Based Permissions:**

- Use when you have an authentication gateway/proxy
- Permissions passed via HTTP headers
- Good for dynamic, frequently-changing permissions
- Requires external validation of headers

**Config-Based Permissions:**

- Use when you want server-side control
- Permissions defined in server configuration
- Better security (no client-provided permission data)
- Good for stable permission structures

### Step 7: Create the permission-based MCP server

**Option A: Header-Based Permissions**

```ts
const createServer = () =>
  new McpServer({
    name: "permission-header-server",
    version: "1.0.0",
    capabilities: { tools: { listChanged: false } },
  });

const { start, close } = await createPermissionBasedMcpServer({
  catalog,
  moduleLoaders,
  permissions: {
    source: "headers",
    headerName: "mcp-toolset-permissions", // optional, this is default
  },
  http: { port: 3000 },
  createServer,
});

await start();
```

**Option B: Config-Based Permissions (Static Map)**

```ts
const createServer = () =>
  new McpServer({
    name: "permission-config-server",
    version: "1.0.0",
    capabilities: { tools: { listChanged: false } },
  });

const { start, close } = await createPermissionBasedMcpServer({
  catalog,
  moduleLoaders,
  permissions: {
    source: "config",
    staticMap: {
      "admin-client-id": ["admin", "user"],
      "user-client-id": ["user"],
    },
    defaultPermissions: [], // unknown clients get no toolsets
  },
  http: { port: 3000 },
  createServer,
});

await start();
```

**Option C: Config-Based Permissions (Resolver Function)**

```ts
const createServer = () =>
  new McpServer({
    name: "permission-resolver-server",
    version: "1.0.0",
    capabilities: { tools: { listChanged: false } },
  });

const { start, close } = await createPermissionBasedMcpServer({
  catalog,
  moduleLoaders,
  permissions: {
    source: "config",
    resolver: (clientId: string) => {
      // Your custom permission logic
      if (clientId.startsWith("admin-")) {
        return ["admin", "user"];
      }
      if (clientId.startsWith("user-")) {
        return ["user"];
      }
      return [];
    },
    defaultPermissions: [],
  },
  http: { port: 3000 },
  createServer,
});

await start();
```

### Step 8: Graceful shutdown

```ts
process.on("SIGINT", async () => {
  await close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await close();
  process.exit(0);
});
```

## Permission configuration approaches

### Header-Based Permissions Setup

Use header-based permissions when you have an authentication gateway or proxy that validates and sets permission headers. This approach is flexible for dynamic permissions but requires external header validation.

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const createServer = () =>
  new McpServer({
    name: "permission-header-server",
    version: "1.0.0",
    capabilities: { tools: { listChanged: false } },
  });

const { start, close } = await createPermissionBasedMcpServer({
  catalog: {
    admin: {
      name: "Admin",
      description: "Admin tools",
      modules: ["admin"],
    },
    user: {
      name: "User",
      description: "User tools",
      modules: ["user"],
    },
  },
  moduleLoaders: {
    admin: async () => [
      /* admin tools */
    ],
    user: async () => [
      /* user tools */
    ],
  },
  permissions: {
    source: "headers",
    headerName: "mcp-toolset-permissions", // optional, this is default
  },
  http: { port: 3000 },
  createServer,
});

await start();
```

**When to use:**

- You have an authentication gateway/proxy that validates requests
- Permissions change frequently or are computed per-request
- You can ensure headers are cryptographically signed or validated
- Your auth system is external to the MCP server

### Config-Based Permissions Setup (Static Map)

Use a static map when you have a fixed set of clients with known permissions. This provides server-side control and better security.

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const createServer = () =>
  new McpServer({
    name: "permission-config-server",
    version: "1.0.0",
    capabilities: { tools: { listChanged: false } },
  });

const { start, close } = await createPermissionBasedMcpServer({
  catalog: {
    admin: {
      name: "Admin",
      description: "Admin tools",
      modules: ["admin"],
    },
    user: {
      name: "User",
      description: "User tools",
      modules: ["user"],
    },
  },
  moduleLoaders: {
    admin: async () => [
      /* admin tools */
    ],
    user: async () => [
      /* user tools */
    ],
  },
  permissions: {
    source: "config",
    staticMap: {
      "admin-client-id": ["admin", "user"],
      "user-client-id": ["user"],
    },
    defaultPermissions: [], // clients not in map get no toolsets
  },
  http: { port: 3000 },
  createServer,
});

await start();
```

**When to use:**

- You have a fixed set of known clients
- Permissions are relatively stable
- You want the highest security level
- You want to avoid trusting client-provided data

### Config-Based Permissions Setup (Resolver Function)

Use a resolver function when you need custom logic to determine permissions, such as looking up from a database or applying complex rules.

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const createServer = () =>
  new McpServer({
    name: "permission-resolver-server",
    version: "1.0.0",
    capabilities: { tools: { listChanged: false } },
  });

const { start, close } = await createPermissionBasedMcpServer({
  catalog: {
    admin: {
      name: "Admin",
      description: "Admin tools",
      modules: ["admin"],
    },
    user: {
      name: "User",
      description: "User tools",
      modules: ["user"],
    },
  },
  moduleLoaders: {
    admin: async () => [
      /* admin tools */
    ],
    user: async () => [
      /* user tools */
    ],
  },
  permissions: {
    source: "config",
    resolver: (clientId: string) => {
      // Custom logic - could check database, config file, etc.
      if (clientId.startsWith("admin-")) {
        return ["admin", "user"];
      }
      if (clientId.startsWith("user-")) {
        return ["user"];
      }
      return [];
    },
    staticMap: {
      // optional fallback
      "special-client": ["admin"],
    },
    defaultPermissions: [],
  },
  http: { port: 3000 },
  createServer,
});

await start();
```

**When to use:**

- You need custom permission logic
- Permissions are computed based on client ID patterns or attributes
- You want to integrate with existing permission systems
- You need fallback behavior with staticMap

**Note:** Resolver functions must be synchronous. If you need to fetch permissions from external sources, do so before server creation and cache the results.

## Custom HTTP endpoints

Toolception supports custom HTTP endpoints alongside MCP protocol endpoints, enabling REST-like APIs with Zod validation and type inference.

### Basic usage

```ts
import { createMcpServer, defineEndpoint } from "toolception";
import { z } from "zod";

const { start } = await createMcpServer({
  // ... standard options
  http: {
    port: 3000,
    customEndpoints: [
      defineEndpoint({
        method: "GET",
        path: "/api/users",
        querySchema: z.object({
          limit: z.coerce.number().int().positive().default(10),
          role: z.enum(["admin", "user"]).optional(),
        }),
        responseSchema: z.object({
          users: z.array(z.object({ id: z.string(), name: z.string() })),
        }),
        handler: async (req) => {
          // req.query is typed: { limit: number, role?: "admin" | "user" }
          // req.clientId is available from mcp-client-id header
          return { users: [{ id: "1", name: "Alice" }] };
        },
      }),
    ],
  },
});
```

### Validation schemas

- **querySchema**: Validates URL query parameters (use `z.coerce` for type conversion)
- **bodySchema**: Validates request body (POST/PUT/PATCH)
- **paramsSchema**: Validates path parameters (e.g., `/users/:userId`)
- **responseSchema**: Validates handler response (prevents invalid data leakage)

### Request context

Handlers receive a typed request object:

```ts
{
  body: TBody,        // Validated from bodySchema
  query: TQuery,      // Validated from querySchema
  params: TParams,    // Validated from paramsSchema
  headers: Record<string, string | string[] | undefined>,
  clientId: string,   // From mcp-client-id header or auto-generated
}
```

### Permission-aware endpoints

Use `definePermissionAwareEndpoint` in permission-based servers to access client permissions:

```ts
import { createPermissionBasedMcpServer, definePermissionAwareEndpoint } from "toolception";

const { start } = await createPermissionBasedMcpServer({
  // ... permission config
  http: {
    customEndpoints: [
      definePermissionAwareEndpoint({
        method: "GET",
        path: "/api/me",
        responseSchema: z.object({
          clientId: z.string(),
          allowedToolsets: z.array(z.string()),
          isAdmin: z.boolean(),
        }),
        handler: async (req) => {
          // req.allowedToolsets and req.failedToolsets are available
          return {
            clientId: req.clientId,
            allowedToolsets: req.allowedToolsets,
            isAdmin: req.allowedToolsets.includes("admin-tools"),
          };
        },
      }),
    ],
  },
});
```

### Error handling

Validation failures return standardized error responses:

- **400 VALIDATION_ERROR**: Request validation failed (body, query, or params)
- **500 INTERNAL_ERROR**: Handler threw an exception
- **500 RESPONSE_VALIDATION_ERROR**: Response validation failed

Example error response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed for query",
    "details": [
      {
        "code": "invalid_type",
        "path": ["limit"],
        "message": "Expected number, received string"
      }
    ]
  }
}
```

### Reserved paths

Custom endpoints cannot override built-in MCP paths:

- `/mcp` - MCP JSON-RPC endpoint
- `/healthz` - Health check
- `/tools` - Tool listing
- `/.well-known/mcp-config` - Configuration schema

### Complete example

See `examples/custom-endpoints-demo.ts` for a full working example with GET, POST, PUT, DELETE endpoints, pagination, and permission-aware handlers.

## Per-session context

Use the `sessionContext` option to enable per-client context values extracted from query parameters. This is useful for multi-tenant scenarios where each client needs different configuration (API tokens, user IDs, etc.) passed to module loaders.

### Basic usage

```ts
import { createMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const { start } = await createMcpServer({
  catalog: { /* ... */ },
  moduleLoaders: { /* ... */ },
  context: { baseValue: 'shared' },  // Base context for all sessions
  sessionContext: {
    enabled: true,
    queryParam: {
      name: 'config',
      encoding: 'base64',
      allowedKeys: ['API_TOKEN', 'USER_ID'],  // Security: always specify
    },
    merge: 'shallow',
  },
  createServer: () => new McpServer({
    name: "my-server",
    version: "1.0.0",
    capabilities: { tools: { listChanged: true } },
  }),
  http: { port: 3000 },
});

await start();
```

### Client connection

```bash
# Encode session config as base64
CONFIG=$(echo -n '{"API_TOKEN":"user-secret-token","USER_ID":"123"}' | base64)

# Connect with session config
curl -X POST "http://localhost:3000/mcp?config=$CONFIG" \
  -H "mcp-client-id: my-client" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize",...}'
```

### Module loader receives merged context

```ts
const moduleLoaders = {
  tenant: async (ctx: any) => {
    // ctx = { baseValue: 'shared', API_TOKEN: 'user-secret-token', USER_ID: '123' }
    return [/* tools using ctx.API_TOKEN */];
  },
};
```

### Custom context resolver

For advanced use cases, provide a custom resolver function:

```ts
sessionContext: {
  enabled: true,
  queryParam: { allowedKeys: ['tenant_id'] },
  contextResolver: (request, baseContext, parsedConfig) => ({
    ...baseContext,
    ...parsedConfig,
    clientId: request.clientId,
    timestamp: Date.now(),
  }),
}
```

### Security considerations

- **Always specify `allowedKeys`**: Without a whitelist, any key in the query config is accepted
- **Fail-secure**: Invalid encoding silently falls back to base context
- **No logging of values**: Session config values are never logged
- **Filtered silently**: Disallowed keys are filtered without error messages

## API

### createMcpServer(options)

Wires your MCP SDK server to dynamic/static tool management and a Fastify HTTP transport.

Requirements

- `createServer` must be provided.
- In DYNAMIC mode, a fresh server instance is created per client via `createServer`.
- In STATIC mode, a single server instance is created once via `createServer` and reused for all clients.

#### options.catalog (required)

`Record<string, ToolSetDefinition>`

- Defines available toolsets to expose. Each item includes `name`, `description`, optional inline `tools`, optional `modules` (for lazy loaders), and optional `decisionCriteria`.

#### options.moduleLoaders (optional)

`Record<string, ModuleLoader>`

- Maps module keys to async loaders returning `McpToolDefinition[]`. Referenced by toolsets via `modules: [key]`.

Usage and behavior

| Aspect           | Details                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key naming       | The object key is the module identifier referenced in `catalog[toolset].modules`. Example: `{ ext: async () => [...] }` and `modules: ["ext"]`.          |
| Loader signature | `(context?: unknown) => Promise<McpToolDefinition[]>` or `McpToolDefinition[]`                                                                           |
| When called      | STATIC mode: at startup (for specified toolsets or ALL). DYNAMIC mode: when a toolset is enabled via meta-tools.                                         |
| Return value     | An array of tools to register. Tool names should be unique per toolset; if `namespaceToolsWithSetKey` is true, names are prefixed at registration.       |
| Errors           | Throwing rejects the enable/preload flow for that toolset and surfaces an error to the caller.                                                           |
| Idempotency      | Loaders may be invoked multiple times across runs/clients. Keep them deterministic/idempotent. Implement internal caching if they perform expensive I/O. |

Example

```ts
const moduleLoaders = {
  ext: async (ctx?: unknown) => [
    {
      name: "echo",
      description: "Echo back provided text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      handler: async ({ text }: { text: string }) => ({
        content: [{ type: "text", text }],
      }),
    },
  ],
};

const catalog = {
  ext: { name: "Extensions", description: "Extra tools", modules: ["ext"] },
};
```

#### options.startup (optional)

`{ mode?: "DYNAMIC" | "STATIC"; toolsets?: string[] | "ALL" }`

- Controls startup behavior. In STATIC mode, pre-load specific toolsets (or ALL). In DYNAMIC, register meta-tools and load on demand.

Startup precedence and validation

| Input                                                | Effective mode | Toolset handling                    | Outcome/Notes                                                                    |
| ---------------------------------------------------- | -------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `startup.mode = "DYNAMIC"` (toolsets present or not) | DYNAMIC        | `startup.toolsets` is ignored       | Manage toolsets at runtime via meta-tools; logs a warning if `toolsets` provided |
| `startup.mode = "STATIC"`, `toolsets = "ALL"`        | STATIC         | Preload all toolsets from `catalog` | OK                                                                               |
| `startup.mode = "STATIC"`, `toolsets = [names]`      | STATIC         | Validate names against `catalog`    | Invalid names warn; if none valid remain → error                                 |
| No `startup.mode`, `toolsets = "ALL"`                | STATIC         | Preload all toolsets                | OK                                                                               |
| No `startup.mode`, `toolsets = [names]`              | STATIC         | Validate names against `catalog`    | Invalid names warn; if none valid remain → error                                 |
| No `startup.mode`, no `toolsets`                     | DYNAMIC        | No preloads                         | Default behavior; manage toolsets at runtime via meta-tools                      |

#### options.registerMetaTools (optional)

`boolean` (default: true in DYNAMIC mode; false in STATIC mode)

- Whether to register meta-tools for toolset management.
- In DYNAMIC mode: Registers all meta-tools (`enable_toolset`, `disable_toolset`, `list_toolsets`, `describe_toolset`, `list_tools`).
- In STATIC mode: Only registers `list_tools` (other meta-tools are not applicable since toolsets are fixed at startup).

#### options.exposurePolicy (optional)

`ExposurePolicy`

- Controls which toolsets can be activated and how tools are named when registered.

| Field                      | Type                          | Purpose                                                                            | Example                                                              |
| -------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `maxActiveToolsets`        | `number`                      | Limit how many toolsets can be active at once. Prevents tool bloat.                | `{ maxActiveToolsets: 1 }` blocks enabling a second toolset          |
| `namespaceToolsWithSetKey` | `boolean`                     | Prefix tool names with the toolset key when registering, to avoid name collisions. | With `true`, enabling `core` registers `core.ping` instead of `ping` |
| `allowlist`                | `string[]`                    | Only these toolsets may be enabled. Others are denied.                             | `{ allowlist: ["core"] }` prevents enabling `ext`                    |
| `denylist`                 | `string[]`                    | These toolsets cannot be enabled.                                                  | `{ denylist: ["ext"] }` blocks `ext`                                 |
| `onLimitExceeded`          | `(attempted, active) => void` | Callback when `maxActiveToolsets` would be exceeded.                               | Log or telemetry hook                                                |

Notes

- Policy is enforced at enable time (via meta-tools or static preload).
- If both `allowlist` and `denylist` are present, the entry must be in `allowlist` and not in `denylist` to pass.
- Namespacing is applied consistently at registration time and reflected in `GET /tools`.

#### options.context (optional)

`unknown`

- Arbitrary context passed to `moduleLoaders` during tool resolution.

| Field     | Type      | Purpose                                                                                      | Example                                                        |
| --------- | --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `context` | `unknown` | Extra data/injectables available to every `ModuleLoader(context)` call when resolving tools. | `{ db, cache, apiClients }` used inside loaders to build tools |

Notes

- Only `moduleLoaders` receive `context`. Direct tools defined inline in `catalog` do not.
- Not exposed to clients over HTTP; it stays in-process on the server.
- Keep it lightweight and stable; prefer passing handles (e.g., db client) rather than huge data blobs.
- STATIC mode: loaders are invoked at startup with the same `context`.
- DYNAMIC mode: loaders are invoked at enable time with the same `context`.

Example

```ts
const moduleLoaders = {
  ext: async (ctx: any) => [
    {
      name: "echo",
      description: "Echo using a backing service",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      handler: async ({ text }: { text: string }) => {
        const result = await ctx.apiClients.echoService.send(text);
        return { content: [{ type: "text", text: result }] } as any;
      },
    },
  ],
};
```

#### options.sessionContext (optional)

`SessionContextConfig`

Configuration for per-session context extraction from query parameters. Enables multi-tenant use cases where each client session can have its own context values passed to module loaders. See [Per-session context](#per-session-context) for detailed usage examples.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Whether session context extraction is enabled |
| `queryParam.name` | `string` | `'config'` | Query parameter name |
| `queryParam.encoding` | `'base64' \| 'json'` | `'base64'` | Encoding format |
| `queryParam.allowedKeys` | `string[]` | - | Whitelist of allowed keys (recommended for security) |
| `contextResolver` | `function` | - | Custom context resolver function |
| `merge` | `'shallow' \| 'deep'` | `'shallow'` | How to merge with base context |

Notes

- Session context is extracted per-request and merged with the base `context` option
- Each unique session config generates a different cache key, enabling per-tenant module caching
- Invalid encoding or parsing errors silently fall back to base context (fail-secure)
- Only applies to DYNAMIC mode servers; STATIC mode uses a single shared server instance

#### options.http (optional)

`{ host?: string; port?: number; basePath?: string; cors?: boolean; logger?: boolean; customEndpoints?: CustomEndpointDefinition[] }`

- Fastify transport configuration. Defaults: host `0.0.0.0`, port `3000`, basePath `/`, CORS enabled, logger disabled.
- `customEndpoints`: Optional array of custom HTTP endpoints to register alongside MCP protocol endpoints. See [Custom HTTP endpoints](#custom-http-endpoints) for details.

#### options.createServer (optional)

`() => McpServer`

Required factory to create the SDK server instance(s).

#### options.configSchema (optional)

`object`

- JSON Schema exposed at `GET /.well-known/mcp-config` for client discovery.

### createPermissionBasedMcpServer(options)

Creates a permission-aware MCP server where each client receives only the toolsets they're authorized to access. This function provides a separate API for permission-based scenarios while maintaining the same interface as `createMcpServer`.

Requirements

- `createServer` must be provided
- `permissions` configuration must be provided
- Server operates in STATIC mode per-client (toolsets determined by permissions)
- Each client gets an isolated server instance with their specific toolsets

#### options.permissions (required)

`PermissionConfig`

Defines how client permissions are resolved and enforced.

**Permission Source Types**

| Source    | Description                           | Use Case                           | Security Level                        |
| --------- | ------------------------------------- | ---------------------------------- | ------------------------------------- |
| `headers` | Read permissions from request headers | Behind authenticated proxy/gateway | Medium (requires external validation) |
| `config`  | Server-side permission lookup         | Direct server control              | High (server-controlled)              |

**Header-Based Configuration**

| Field        | Type        | Default                     | Description                                         |
| ------------ | ----------- | --------------------------- | --------------------------------------------------- |
| `source`     | `'headers'` | required                    | Indicates header-based permissions                  |
| `headerName` | `string`    | `'mcp-toolset-permissions'` | Header name containing comma-separated toolset list |

**Config-Based Configuration**

| Field                | Type                             | Required                     | Description                                              |
| -------------------- | -------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `source`             | `'config'`                       | yes                          | Indicates config-based permissions                       |
| `staticMap`          | `Record<string, string[]>`       | one of staticMap or resolver | Maps client IDs to toolset arrays                        |
| `resolver`           | `(clientId: string) => string[]` | one of staticMap or resolver | Function returning toolset array for client              |
| `defaultPermissions` | `string[]`                       | no                           | Fallback permissions for unknown clients (default: `[]`) |

**Notes**

- For config-based permissions, at least one of `staticMap` or `resolver` must be provided
- If both are provided, `resolver` is tried first, then `staticMap`, then `defaultPermissions`
- Resolver functions must be synchronous and return string arrays
- Invalid toolset names in permissions are filtered out during server creation

#### options.catalog (required)

Same as `createMcpServer` - see [options.catalog](#optionscatalog-required).

#### options.moduleLoaders (optional)

Same as `createMcpServer` - see [options.moduleLoaders](#optionsmoduleloaders-optional).

#### options.exposurePolicy (optional)

`ExposurePolicy` (partial support)

Permission-based servers only support `namespaceToolsWithSetKey`. Other policy fields are ignored because toolset access is controlled by permissions:

| Field                      | Support                                           |
| -------------------------- | ------------------------------------------------- |
| `namespaceToolsWithSetKey` | ✅ Supported (default: true)                       |
| `allowlist`                | ⚠️ Ignored (determined by client permissions)     |
| `denylist`                 | ⚠️ Ignored (use permissions instead)              |
| `maxActiveToolsets`        | ⚠️ Ignored (determined by permission count)       |
| `onLimitExceeded`          | ⚠️ Ignored (no toolset limits enforced)           |

**Note:** If you provide ignored options, the server will log warnings at startup to alert you.

#### options.http (optional)

Same as `createMcpServer` - see [options.http](#optionshttp-optional).

#### options.createServer (required)

Same as `createMcpServer` - see [options.createServer](#optionscreateserver-optional).

#### options.configSchema (optional)

Same as `createMcpServer` - see [options.configSchema](#optionsconfigschema-optional).

#### options.context (optional)

Same as `createMcpServer` - see [options.context](#optionscontext-optional).

#### options.sessionContext (optional)

`SessionContextConfig`

Session context is available in permission-based servers but has limited support. Because permission-based servers determine toolsets at connection time based on permissions, the session context cannot affect which toolsets are loaded. However, the merged context is still passed to module loaders.

**Note:** A warning is issued if `sessionContext` is used with `createPermissionBasedMcpServer`. For full session context support with per-session toolset caching, use `createMcpServer` with DYNAMIC mode.

### Meta-tools

Meta-tools are registered based on mode:

**DYNAMIC mode** (registered by default, or when `registerMetaTools` is true):

- `enable_toolset` - Enable a toolset by name
- `disable_toolset` - Disable a toolset by name (state only; tools remain registered)
- `list_toolsets` - List available toolsets with active status
- `describe_toolset` - Describe a specific toolset with definition and tools
- `list_tools` - List currently registered tool names

**STATIC mode** (when `registerMetaTools` is true):

- `list_tools` - List currently registered tool names

Note: In STATIC mode, `enable_toolset`, `disable_toolset`, `list_toolsets`, and `describe_toolset` are not available since toolsets are fixed at startup.

## Permission-based client integration

### Using Header-Based Permissions

When connecting to a permission-based server with header-based permissions, include the `mcp-toolset-permissions` header with a comma-separated list of toolsets:

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const clientId = "my-client-id";
const allowedToolsets = ["user", "reports"]; // determined by your auth system

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: {
      headers: {
        "mcp-client-id": clientId,
        "mcp-toolset-permissions": allowedToolsets.join(","),
      },
    },
  }
);

const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);

// Client can only access tools from 'user' and 'reports' toolsets
const tools = await client.listTools();
console.log(tools); // Only shows user.* and reports.* tools

await client.close();
```

**Important:** Your application layer must validate and potentially sign/encrypt the permission header to prevent tampering. The MCP server trusts the header value as-is.

### Using Config-Based Permissions

When connecting to a permission-based server with config-based permissions, only provide the `mcp-client-id` header. The server looks up permissions internally:

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const clientId = "admin-client-id"; // matches server's staticMap or resolver

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: {
      headers: {
        "mcp-client-id": clientId,
        // No permission header needed - server looks up permissions
      },
    },
  }
);

const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);

// Client receives toolsets based on server configuration
const tools = await client.listTools();
console.log(tools); // Shows tools based on server's permission config

await client.close();
```

**Security:** Config-based permissions provide better security since the client cannot influence their own permissions. Ensure your client IDs are authenticated and validated before reaching the MCP server.

## Client ID lifecycle

- **What**: Clients identify themselves via the `mcp-client-id` HTTP header on every request.
- **Who generates it**: The client. Use a stable identifier (e.g., UUID persisted locally).
- **If omitted**: MCP protocol endpoints (`POST /mcp`, `GET /mcp`, `DELETE /mcp`) return a 400 error. Custom endpoints still accept anonymous clients with auto-generated IDs.

Examples (official MCP client)

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Create a stable client id (persist it for reuse across runs)
const clientId = "my-stable-client-id"; // e.g., from disk/env

// Transport manages HTTP, including SSE and JSON-RPC framing
const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: { headers: { "mcp-client-id": clientId } },
  }
);

// High-level MCP client
const client = new Client({ name: "example-client", version: "1.0.0" });

// Connect negotiates capabilities and establishes a session. Transport handles session id.
await client.connect(transport);

// Call a tool (example)
const res = await client.listTools();
console.log(res);

// Close when done
await client.close();
```

## Session ID lifecycle

- **What**: A per-session identifier returned by the server on initialize.
- **Who generates it**: The server during initialize. The client must read it from the initialize response headers and send it back on subsequent requests via `mcp-session-id`.
- **Used for**: Follow-up JSON-RPC requests (POST `/mcp`), SSE stream (GET `/mcp`), and termination (DELETE `/mcp`).

Examples (official MCP client)

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const clientId = "my-stable-client-id";
const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: { headers: { "mcp-client-id": clientId } },
  }
);

const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);

// Session id is handled by the transport. No need to manually set mcp-session-id.

// Call tools
await client.callTool({ name: "enable_toolset", arguments: { name: "core" } });
const ping = await client.callTool({ name: "core.ping", arguments: {} });
console.log(ping);

// When finished
await client.close();
```

## Permission-based security best practices

### When to Use Each Approach

**Use Header-Based Permissions When:**

- You have an authentication gateway/proxy that validates and sets headers
- You need dynamic permissions that change frequently
- Your auth system is external to the MCP server
- You can ensure headers are cryptographically signed or validated

**Use Config-Based Permissions When:**

- You want server-side control over permissions
- Permissions are relatively stable
- You need the highest security level
- You want to avoid trusting client-provided data

### Authentication and Authorization Patterns

**Header-Based Pattern:**

```
Client → Auth Gateway → MCP Server
         (validates,
          sets headers)
```

The auth gateway must:

1. Authenticate the client
2. Determine authorized toolsets
3. Set `mcp-toolset-permissions` header
4. Optionally sign/encrypt headers to prevent tampering

**Config-Based Pattern:**

```
Client → MCP Server → Permission Lookup
         (validates     (staticMap or
          client-id)     resolver)
```

The MCP server:

1. Receives client-id
2. Looks up permissions internally
3. No trust in client-provided permission data

### Header Validation and Signing

If using header-based permissions, implement validation to prevent tampering:

```ts
import crypto from "crypto";

// Example: Using HMAC to sign permission headers
function signPermissions(
  clientId: string,
  toolsets: string[],
  secret: string
): string {
  const data = `${clientId}:${toolsets.join(",")}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("hex");
  return `${toolsets.join(",")};sig=${signature}`;
}

function verifyPermissions(
  clientId: string,
  headerValue: string,
  secret: string
): string[] {
  const [toolsetsStr, sigPart] = headerValue.split(";sig=");
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${clientId}:${toolsetsStr}`)
    .digest("hex");

  if (sigPart !== expectedSig) {
    throw new Error("Invalid permission signature");
  }

  return toolsetsStr.split(",").map((s) => s.trim());
}

// In your auth gateway:
const clientId = "user-123";
const allowedToolsets = ["user", "reports"];
const signedHeader = signPermissions(clientId, allowedToolsets, SECRET_KEY);

// Forward to MCP server with signed header
fetch("http://mcp-server:3000/mcp", {
  headers: {
    "mcp-client-id": clientId,
    "mcp-toolset-permissions": signedHeader,
  },
});
```

### Security Considerations

**Header-Based Permissions:**

- **Risk:** Client can potentially manipulate headers if not properly secured
- **Mitigation:** Always validate/sign headers in your application layer
- **Recommendation:** Use only behind authenticated reverse proxy or gateway
- **Best Practice:** Implement header signing with HMAC or JWT

**Config-Based Permissions:**

- **Benefit:** Server-side permission storage provides stronger security
- **Recommendation:** Preferred for production environments
- **Best Practice:** Authenticate client IDs before they reach the MCP server
- **Note:** No client-side permission data exposure

**General Security:**

- **Permission Caching:** Permissions are cached per client session. Invalidate sessions when permissions change.
- **Client Isolation:** Each client gets an isolated server instance. No cross-client permission leakage.
- **Error Messages:** The server avoids exposing unauthorized toolset names in error responses.
- **Client ID Validation:** Always validate and authenticate client IDs in your application layer before requests reach the MCP server.

### Error Handling and Information Disclosure

When a client attempts to access unauthorized toolsets:

- The server returns a generic "Access denied" error
- Unauthorized toolset names are not exposed in error messages
- This prevents information disclosure about available toolsets
- Clients only see tools they're authorized to access via `listTools()`

## Permission-based common patterns

### Multi-Tenant Server Setup

Create a server where each tenant has access to their own toolsets plus shared tools:

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const { start, close } = await createPermissionBasedMcpServer({
  catalog: {
    "tenant-a-tools": {
      name: "Tenant A",
      description: "Tools for tenant A",
      modules: ["tenant-a"],
    },
    "tenant-b-tools": {
      name: "Tenant B",
      description: "Tools for tenant B",
      modules: ["tenant-b"],
    },
    "shared-tools": {
      name: "Shared",
      description: "Shared tools",
      modules: ["shared"],
    },
  },
  moduleLoaders: {
    "tenant-a": async () => [
      /* tenant A specific tools */
    ],
    "tenant-b": async () => [
      /* tenant B specific tools */
    ],
    shared: async () => [
      /* shared tools */
    ],
  },
  permissions: {
    source: "config",
    resolver: (clientId: string) => {
      const [tenant] = clientId.split("-");
      if (tenant === "tenantA") {
        return ["tenant-a-tools", "shared-tools"];
      }
      if (tenant === "tenantB") {
        return ["tenant-b-tools", "shared-tools"];
      }
      return ["shared-tools"]; // unknown tenants get only shared tools
    },
  },
  http: { port: 3000 },
  createServer: () =>
    new McpServer({
      name: "multi-tenant-server",
      version: "1.0.0",
      capabilities: { tools: { listChanged: false } },
    }),
});

await start();
```

### Integration with External Auth Systems

Integrate with an external authentication system by pre-loading permissions:

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Pre-load permissions from your auth system
// This should be done before server creation and cached
const permissionCache = new Map<string, string[]>();

async function loadPermissionsFromAuthSystem() {
  // Fetch permissions from your auth system
  // This is just an example - implement according to your system
  const users = await authSystem.getAllUsers();
  for (const user of users) {
    const permissions = await authSystem.getUserPermissions(user.id);
    permissionCache.set(user.id, permissions.allowedToolsets);
  }
}

// Load permissions at startup
await loadPermissionsFromAuthSystem();

// Optionally refresh permissions periodically
setInterval(loadPermissionsFromAuthSystem, 5 * 60 * 1000); // every 5 minutes

const { start, close } = await createPermissionBasedMcpServer({
  catalog: {
    /* your toolsets */
  },
  moduleLoaders: {
    /* your loaders */
  },
  permissions: {
    source: "config",
    resolver: (clientId: string) => {
      // Synchronous lookup from pre-loaded cache
      return permissionCache.get(clientId) || [];
    },
    defaultPermissions: ["public"], // unauthenticated users get public tools
  },
  http: { port: 3000 },
  createServer: () =>
    new McpServer({
      name: "auth-integrated-server",
      version: "1.0.0",
      capabilities: { tools: { listChanged: false } },
    }),
});

await start();
```

### Role-Based Access Control (RBAC)

Implement role-based access control with predefined role-to-toolset mappings:

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Define role-to-toolset mappings
const rolePermissions = {
  admin: ["admin-tools", "user-tools", "reports", "analytics"],
  manager: ["user-tools", "reports", "analytics"],
  user: ["user-tools", "reports"],
  guest: ["public-tools"],
};

// Map client IDs to roles (could come from database, JWT claims, etc.)
function getRoleForClient(clientId: string): string {
  // Example: extract role from client ID or look up in database
  if (clientId.startsWith("admin-")) return "admin";
  if (clientId.startsWith("manager-")) return "manager";
  if (clientId.startsWith("user-")) return "user";
  return "guest";
}

const { start, close } = await createPermissionBasedMcpServer({
  catalog: {
    "admin-tools": {
      name: "Admin",
      description: "Admin tools",
      modules: ["admin"],
    },
    "user-tools": {
      name: "User",
      description: "User tools",
      modules: ["user"],
    },
    reports: {
      name: "Reports",
      description: "Reporting tools",
      modules: ["reports"],
    },
    analytics: {
      name: "Analytics",
      description: "Analytics tools",
      modules: ["analytics"],
    },
    "public-tools": {
      name: "Public",
      description: "Public tools",
      modules: ["public"],
    },
  },
  moduleLoaders: {
    admin: async () => [
      /* admin tools */
    ],
    user: async () => [
      /* user tools */
    ],
    reports: async () => [
      /* report tools */
    ],
    analytics: async () => [
      /* analytics tools */
    ],
    public: async () => [
      /* public tools */
    ],
  },
  permissions: {
    source: "config",
    staticMap: {
      // Known admin users
      "admin-user-1": rolePermissions.admin,
      "admin-user-2": rolePermissions.admin,
      // Known managers
      "manager-user-1": rolePermissions.manager,
      // Known regular users
      "regular-user-1": rolePermissions.user,
      "regular-user-2": rolePermissions.user,
    },
    resolver: (clientId: string) => {
      // Dynamic role lookup for clients not in static map
      const role = getRoleForClient(clientId);
      return rolePermissions[role] || rolePermissions.guest;
    },
    defaultPermissions: rolePermissions.guest,
  },
  http: { port: 3000 },
  createServer: () =>
    new McpServer({
      name: "rbac-server",
      version: "1.0.0",
      capabilities: { tools: { listChanged: false } },
    }),
});

await start();
```

## Tool types

- Direct tools: defined inline under `catalog[toolset].tools` and registered when that toolset is enabled.
- Module-produced tools: returned by `moduleLoaders[moduleKey]()` and registered when enabling a toolset that references `modules: [moduleKey]`.

Use direct tools for simple/local utilities; use module-produced tools to share tools across multiple toolsets or lazily load heavier definitions.

Note on dynamic mode: Both direct and module-produced tools are supported. Module-produced tools help minimize startup footprint by enabling on-demand loading at enable-time.

## Startup modes

The server operates in one of two primary modes:

1. **Dynamic mode** (`startup.mode = "DYNAMIC"`)

   - All meta-tools registered: `enable_toolset`, `disable_toolset`, `list_toolsets`, `describe_toolset`, `list_tools`
   - Tools are loaded on-demand via meta-tool calls
   - Each client gets an isolated server instance
   - Best for flexible, task-specific workflows where tool needs change

2. **Static mode** (`startup.mode = "STATIC"`)
   - Pre-loads specific toolsets at startup (`toolsets` array or "ALL")
   - Only `list_tools` meta-tool is available (toolsets cannot be changed at runtime)
   - A single server instance is reused for all clients
   - Best for known, consistent tool requirements

## License

Apache-2.0. See `LICENSE` for details.
