# Implementation Plan: Per-Client Permission-Based Toolset Loading

**Branch:** `benr/feat-load-static-toolset-given-permission`

**Feature:** Add support for per-client permission-based toolset access using STATIC mode configuration per client.

**Mode:** STATIC only (first step) - toolsets pre-loaded at connection time

**Goal:** Create `createPermissionBasedMcpServer` - a new function that enables permission-based tool access without modifying existing APIs.

## Overview

Enable developers to create permission-based MCP servers where each client receives only the toolsets they're authorized to access. This is achieved by combining server-level DYNAMIC mode (per-client isolation) with client-level STATIC mode (pre-loaded permitted toolsets).

## Key Design Decision

**Separate Function Approach** ✅

We will create a **new exported function** `createPermissionBasedMcpServer` rather than adding options to the existing `createMcpServer`.

**Rationale:**
- ✅ **Zero breaking changes** - existing `createMcpServer` remains completely untouched
- ✅ **Clear intent** - function name immediately communicates purpose
- ✅ **Simpler APIs** - each function focused on specific use case
- ✅ **Better DX** - users pick the right tool for their needs
- ✅ **Independent evolution** - permission features can evolve separately
- ✅ **Easier documentation** - clear separation in README and examples

## Scope and Limitations (First Step)

**STATIC Mode Only** 🎯

This initial implementation **only supports STATIC mode** for per-client toolsets:
- ✅ Each client gets a pre-loaded set of toolsets based on their permissions
- ✅ Toolsets are loaded at bundle creation time (STATIC mode)
- ❌ No runtime enable/disable of toolsets (DYNAMIC mode) per client
- ❌ No meta-tools like `enable_toolset`, `disable_toolset` in client bundles

**Why STATIC Only:**
- **Simpler implementation** - focuses on the core permission use case
- **Clear security model** - permissions enforced once at connection time
- **Better performance** - no runtime overhead for permission checks
- **Easier testing** - deterministic behavior per client

**Future Enhancement:**
Dynamic mode support can be added later if needed (e.g., allowing clients to enable additional permitted toolsets at runtime).

## Feature Verification

### 🔑 **Key Architecture Principle**

**This is a consumed library** - it **does NOT** perform permission lookups itself.

**How It Works:**
1. **Client sends `mcp-client-id` header** with each HTTP request
2. **Library extracts** `clientId` from the header
3. **Library calls** user-provided `createServerForClient(clientId)` function
4. **User's function** performs the lookup (their DB, their auth, their logic)
5. **User's function** returns server config with permitted toolsets
6. **Library** creates the bundle with those toolsets

**When Lookup Happens:** 
- **STATIC mode (this PR):** Lookup happens **once at first connection** (bundle creation time)
- **Future DYNAMIC mode:** Could happen on each request or at runtime

### 📊 Flow Diagram (STATIC Mode)

```
┌─────────────┐                    ┌──────────────────┐                    ┌─────────────────┐
│   Client    │                    │  Toolception     │                    │  User's App     │
│             │                    │  (Library)       │                    │  (Consumer)     │
└──────┬──────┘                    └────────┬─────────┘                    └────────┬────────┘
       │                                    │                                       │
       │ 1. POST /mcp                       │                                       │
       │    Header: mcp-client-id: "user123"│                                       │
       ├───────────────────────────────────>│                                       │
       │                                    │                                       │
       │                                    │ 2. Extract clientId from header       │
       │                                    │    clientId = "user123"               │
       │                                    │                                       │
       │                                    │ 3. Call createServerForClient("user123")│
       │                                    ├──────────────────────────────────────>│
       │                                    │                                       │
       │                                    │                                       │ 4. User's code
       │                                    │                                       │    queries DB/auth
       │                                    │                                       │    for permissions
       │                                    │                                       │
       │                                    │ 5. Return { server, toolsets: [...] }│
       │                                    │<──────────────────────────────────────│
       │                                    │                                       │
       │                                    │ 6. Create ServerOrchestrator          │
       │                                    │    with STATIC mode + those toolsets  │
       │                                    │                                       │
       │                                    │ 7. Cache bundle for this clientId     │
       │                                    │                                       │
       │ 8. Response with tools pre-loaded  │                                       │
       │<───────────────────────────────────┤                                       │
       │                                    │                                       │
       │ 9. Future requests with same       │                                       │
       │    mcp-client-id use cached bundle │                                       │
       │    (no re-lookup)                  │                                       │
       │                                    │                                       │
```

**Key Points:**
- Library **never** accesses user's database or auth system
- User provides the `createServerForClient` callback that does the lookup
- Lookup happens **once** when client first connects
- Bundle is **cached** per clientId (no re-lookup on subsequent requests)

### 🔀 Division of Responsibility

| Responsibility | Who Does It | How |
|----------------|-------------|-----|
| **Extract clientId from HTTP header** | ⚙️ Library (Toolception) | FastifyTransport reads `mcp-client-id` header |
| **Call permission callback** | ⚙️ Library (Toolception) | Calls user's `createServerForClient(clientId)` |
| **Look up user permissions** | 👤 User's Application | User queries their DB/auth in the callback |
| **Calculate allowed toolsets** | 👤 User's Application | User returns `toolsets: [...]` array |
| **Create server bundle** | ⚙️ Library (Toolception) | Creates ServerOrchestrator with those toolsets |
| **Cache bundle per client** | ⚙️ Library (Toolception) | FastifyTransport caches by clientId |
| **Pre-load toolsets in STATIC mode** | ⚙️ Library (Toolception) | ServerOrchestrator loads all toolsets at creation |

**Summary:** Library handles MCP infrastructure, user handles permission logic. Clean separation! ✨

---

### ✅ Supported Use Cases

#### 1. Permission Lookup by User's Application (Most Common)
```typescript
// USER'S APPLICATION CODE (not library code)
createServerForClient: async (clientId: string) => {
  // User's application does the lookup using their own systems
  const user = await database.users.findById(clientId);
  const permissions = await permissionService.getToolsets(user.role);
  
  return {
    server: new McpServer({ /* ... */ }),
    toolsets: permissions.allowedToolsets, // e.g., ["core", "analytics", "admin"]
  };
}
```

#### 2. Static Assignment (No Lookup)
```typescript
// USER'S APPLICATION CODE (not library code)
createServerForClient: async (clientId: string) => {
  // No lookup needed - all clients get same toolsets
  return {
    server: new McpServer({ /* ... */ }),
    toolsets: ["core", "basic"], // Same for everyone
  };
}
```

#### 3. N Toolsets Support (Unlimited)
The API supports **any number of toolsets**:

```typescript
// Example: Admin with 5 toolsets
toolsets: ["core", "admin", "analytics", "billing", "audit"]

// Example: User with 2 toolsets
toolsets: ["core", "reports"]

// Example: Guest with 1 toolset
toolsets: ["core"]

// Example: Super admin with ALL toolsets
toolsets: "ALL"

// Example: No access
toolsets: [] // Empty array = no tools
```

#### 4. Complex Permission Logic
```typescript
createServerForClient: async (clientId: string) => {
  // Complex multi-parameter lookup
  const user = await getUserProfile(clientId);
  const subscription = await getSubscription(user.orgId);
  const features = await getEnabledFeatures(user.orgId);
  
  // Build toolset array based on multiple factors
  const toolsets = ["core"]; // Everyone gets core
  
  if (subscription.tier === "pro") {
    toolsets.push("analytics", "reports");
  }
  
  if (subscription.tier === "enterprise") {
    toolsets.push("analytics", "reports", "admin", "audit");
  }
  
  if (features.includes("billing")) {
    toolsets.push("billing");
  }
  
  if (user.role === "admin") {
    toolsets.push("admin");
  }
  
  return {
    server: new McpServer({ /* ... */ }),
    toolsets, // N toolsets based on complex logic
  };
}
```

### Key Capabilities

✅ **Flexible Lookup**: Permission lookup can use any logic (DB, API, JWT, config file, etc.) - **YOU provide the logic**  
✅ **Parameter Optional**: Can ignore `clientId` for static assignments  
✅ **N Toolsets**: Supports any number of toolsets (0 to ALL)  
✅ **Dynamic Calculation**: Toolset array can be calculated at runtime - **in YOUR callback**  
✅ **Async Operations**: Factory is async, supports database/API calls - **YOUR database, YOUR API**  
✅ **Per-Client Isolation**: Each client gets their own server bundle with specific toolsets  
✅ **Separation of Concerns**: Library handles MCP server creation, YOU handle permission logic

### Summary Table

| Feature | Supported | Example |
|---------|-----------|---------|
| **Permission lookup WITH parameters** | ✅ Yes | Use `clientId` to query DB/API |
| **Permission lookup WITHOUT parameters** | ✅ Yes | Ignore `clientId`, return static config |
| **Single toolset (1)** | ✅ Yes | `["core"]` |
| **Two toolsets (2)** | ✅ Yes | `["core", "reports"]` |
| **Multiple toolsets (3+)** | ✅ Yes | `["core", "admin", "analytics", "billing", "audit"]` |
| **All toolsets** | ✅ Yes | `"ALL"` |
| **No toolsets** | ✅ Yes | `[]` |
| **Async permission lookup** | ✅ Yes | `await database.query(...)` |
| **Complex permission logic** | ✅ Yes | Role + subscription + features |
| **Different toolsets per client** | ✅ Yes | Each client gets unique array |

### New Function (Separate from `createMcpServer`)

We will export a **new function** `createPermissionBasedMcpServer` that is purpose-built for permission-based scenarios:

```typescript
export async function createPermissionBasedMcpServer(options: {
  catalog: ToolSetCatalog;
  moduleLoaders?: Record<string, ModuleLoader>;
  context?: unknown;
  http?: FastifyTransportOptions;
  configSchema?: object;
  
  createServerForClient: (clientId: string) => Promise<{
    server: McpServer;
    toolsets: string[] | "ALL";
    exposurePolicy?: ExposurePolicy;
  }>;
})
```

**Key Features:**
- **STATIC mode only** - toolsets pre-loaded at bundle creation
- **No meta-tools** - clients get direct access to their permitted tools
- **No runtime enable/disable** - simpler, more secure model

**Key Benefits:**
- **Zero changes** to existing `createMcpServer` API
- **Clear intent** - function name describes purpose
- **Simpler API** - focused on permission use case
- **Better DX** - users pick the right function for their needs
- **Independent evolution** - can add permission-specific features

## Implementation Steps

### Phase 1: Core Implementation (2 Steps)

#### Step 1.1: Create New Permission-Based Function
**File:** `src/server/createPermissionBasedMcpServer.ts` (NEW)

**Purpose:** Create a new, focused function for permission-based MCP servers that is completely separate from `createMcpServer`.

**Implementation:**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ExposurePolicy, ToolSetCatalog, ModuleLoader } from "../types/index.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
import {
  FastifyTransport,
  type FastifyTransportOptions,
} from "../http/FastifyTransport.js";

export interface CreatePermissionBasedMcpServerOptions {
  /** Catalog of available toolsets */
  catalog: ToolSetCatalog;
  
  /** Optional module loaders for lazy-loading tools */
  moduleLoaders?: Record<string, ModuleLoader>;
  
  /** Optional context passed to module loaders */
  context?: unknown;
  
  /** HTTP transport configuration */
  http?: FastifyTransportOptions;
  
  /** Optional JSON Schema for config discovery */
  configSchema?: object;
  
  /** 
   * Factory that creates a server configuration for each client.
   * Receives clientId and should return server instance + toolset configuration.
   * 
   * IMPORTANT: This function enforces STATIC mode only.
   * - Toolsets are pre-loaded at bundle creation time
   * - No meta-tools are registered (clients get direct tool access)
   * - No runtime enable/disable of toolsets
   */
  createServerForClient: (clientId: string) => Promise<{
    /** Fresh McpServer instance for this client */
    server: McpServer;
    /** Toolsets this client is allowed to access (pre-loaded in STATIC mode) */
    toolsets: string[] | "ALL";
    /** Client-specific exposure policy */
    exposurePolicy?: ExposurePolicy;
  }>;
}

export async function createPermissionBasedMcpServer(
  options: CreatePermissionBasedMcpServerOptions
) {
  if (typeof options.createServerForClient !== "function") {
    throw new Error(
      "createPermissionBasedMcpServer: `createServerForClient` is required"
    );
  }

  // Typed, guarded notifier for tools.listChanged
  type NotifierA = {
    server: { notification: (msg: { method: string }) => Promise<void> | void };
  };
  type NotifierB = { notifyToolsListChanged: () => Promise<void> | void };
  const hasNotifierA = (s: unknown): s is NotifierA =>
    typeof (s as any)?.server?.notification === "function";
  const hasNotifierB = (s: unknown): s is NotifierB =>
    typeof (s as any)?.notifyToolsListChanged === "function";
  const notifyToolsChanged = async (target: unknown) => {
    try {
      if (hasNotifierA(target)) {
        await target.server.notification({
          method: "notifications/tools/list_changed",
        });
        return;
      }
      if (hasNotifierB(target)) {
        await target.notifyToolsListChanged();
      }
    } catch {}
  };

  // Create initial server for default manager
  const initialConfig = await options.createServerForClient("__init__");
  const initialServer = initialConfig.server;

  // Create initial orchestrator for default manager
  const initialOrchestrator = new ServerOrchestrator({
    server: initialServer,
    catalog: options.catalog,
    moduleLoaders: options.moduleLoaders,
    exposurePolicy: initialConfig.exposurePolicy,
    context: options.context,
    notifyToolsListChanged: async () => notifyToolsChanged(initialServer),
    startup: {
      mode: "STATIC", // Hardcoded: STATIC mode only
      toolsets: initialConfig.toolsets,
    },
    registerMetaTools: false, // Hardcoded: No meta-tools in permission-based mode
  });

  // Bundle factory for per-client configuration
  const bundleFactory = async (clientId: string) => {
    const config = await options.createServerForClient(clientId);

    // Create orchestrator with client's configuration (STATIC mode enforced)
    const orchestrator = new ServerOrchestrator({
      server: config.server,
      catalog: options.catalog,
      moduleLoaders: options.moduleLoaders,
      exposurePolicy: config.exposurePolicy,
      context: options.context,
      notifyToolsListChanged: async () => notifyToolsChanged(config.server),
      startup: {
        mode: "STATIC", // Hardcoded: STATIC mode only
        toolsets: config.toolsets,
      },
      registerMetaTools: false, // Hardcoded: No meta-tools in permission-based mode
    });

    return { server: config.server, orchestrator };
  };

  // Create HTTP transport with per-client bundles
  const transport = new FastifyTransport(
    initialOrchestrator.getManager(),
    bundleFactory,
    options.http,
    options.configSchema
  );

  return {
    server: initialServer,
    start: async () => {
      await transport.start();
    },
    close: async () => {
      await transport.stop();
    },
  };
}
```

**Reason:** 
- Creates a dedicated function for permission-based use case
- **Enforces STATIC mode** - toolsets pre-loaded at bundle creation
- **No meta-tools** - clients get direct tool access only
- No changes to existing `createMcpServer` function
- Simpler API focused on permissions
- Better separation of concerns

**Breaking Change Risk:** ❌ None - completely new function

**STATIC Mode Enforcement:**
- Function hardcodes `mode: "STATIC"` in all ServerOrchestrator calls
- Function hardcodes `registerMetaTools: false` in all ServerOrchestrator calls
- API does not expose mode or registerMetaTools options to users

---

#### Step 1.2: Update FastifyTransport to Support Async Bundle Factory
**File:** `src/http/FastifyTransport.ts`

**Changes:**
Make `createBundle` parameter explicitly async (if not already) to support the new permission-based flow.

**Code Changes:**

```typescript
// Line ~35: Update field declaration (make explicitly async)
private readonly createBundle: (clientId: string) => Promise<{
  server: McpServer;
  orchestrator: ServerOrchestrator;
}>;

// Line ~50: Update constructor parameter
constructor(
  defaultManager: DynamicToolManager,
  createBundle: (clientId: string) => Promise<{
    server: McpServer;
    orchestrator: ServerOrchestrator;
  }>,
  options: FastifyTransportOptions = {},
  configSchema?: object
) {
  // ... existing code
}

// Line ~116: Ensure bundle creation is awaited (should already be)
let bundle = useCache ? this.clientCache.get(clientId) : null;
if (!bundle) {
  const created = await this.createBundle(clientId); // Pass clientId
  // ... rest of existing code
}
```

**Changes to `createMcpServer.ts`:**
Wrap the existing `createServer` factory to make it async-compatible:

```typescript
// In createMcpServer function, around line ~69
const transport = new FastifyTransport(
  orchestrator.getManager(),
  async (clientId: string) => {  // Make wrapper async
    // Create a server + orchestrator bundle for a new client when needed
    if (mode === "STATIC") {
      return { server: baseServer, orchestrator };
    }
    const createdServer: McpServer = options.createServer();
    const createdOrchestrator = new ServerOrchestrator({
      server: createdServer,
      catalog: options.catalog,
      moduleLoaders: options.moduleLoaders,
      exposurePolicy: options.exposurePolicy,
      context: options.context,
      notifyToolsListChanged: async () => notifyToolsChanged(createdServer),
      startup: options.startup,
      registerMetaTools:
        options.registerMetaTools !== undefined
          ? options.registerMetaTools
          : mode === "DYNAMIC",
    });
    return { server: createdServer, orchestrator: createdOrchestrator };
  },
  options.http,
  options.configSchema
);
```

**Reason:** 
- Ensures `FastifyTransport` can handle async bundle factories
- Minimal change to existing `createMcpServer` - just wrap factory in async
- Enables new `createPermissionBasedMcpServer` to work properly

**Breaking Change Risk:** ❌ None - wrapping in async is backward compatible

---

### Phase 2: Documentation

#### Step 2.1: Export New Function from Public API
**File:** `src/index.ts`

**Changes:**
Add the new function and its types to exports:

```typescript
export { createMcpServer } from "./server/createMcpServer.js";
export type { CreateMcpServerOptions } from "./server/createMcpServer.js";

// NEW: Export permission-based server function
export { createPermissionBasedMcpServer } from "./server/createPermissionBasedMcpServer.js";
export type { CreatePermissionBasedMcpServerOptions } from "./server/createPermissionBasedMcpServer.js";

export type {
  ToolSetCatalog,
  ToolSetDefinition,
  McpToolDefinition,
  ExposurePolicy,
  Mode,
  ModuleLoader,
} from "./types/index.js";
```

**Reason:** Make new function available to users.

**Breaking Change Risk:** ❌ None - only adds new exports

---

#### Step 2.2: Add Demo File
**File:** `tests/smoke-e2e/permission-based-demo.ts` (NEW)

**Content:**
- Complete working example using `createPermissionBasedMcpServer`
- **Mock permission system implemented by the demo application** (in-memory Map):
  ```typescript
  // This is USER'S CODE (not library code)
  const permissions = new Map([
    ["admin-123", { role: "admin", toolsets: ["core", "admin", "analytics", "billing", "audit"] }],
    ["power-456", { role: "power", toolsets: ["core", "analytics", "reports"] }],
    ["user-789", { role: "user", toolsets: ["core", "reports"] }],
    ["guest-000", { role: "guest", toolsets: ["core"] }]
  ]);
  
  async function getClientPermissions(clientId: string) {
    return permissions.get(clientId) || { role: "guest", toolsets: ["core"] };
  }
  ```
- Multiple client roles demonstrating N toolsets:
  - **Admin**: 5 toolsets `["core", "admin", "analytics", "billing", "audit"]`
  - **Power User**: 3 toolsets `["core", "analytics", "reports"]`
  - **User**: 2 toolsets `["core", "reports"]`
  - **Guest**: 1 toolset `["core"]`
- Shows how user's application provides `createServerForClient` callback
- Comments explaining:
  - What the library does (extract clientId, call callback, create bundle)
  - What the user's code does (permission lookup, return config)
  - When lookup happens (once at first connection)

**Purpose:** Demonstrate how users integrate their own permission system with the library.

---

#### Step 2.3: Update README - Add to "When to use Toolception"
**File:** `README.md`

**Location:** After line ~33 in "When to use Toolception" section

**Addition:**
```markdown
- **Permission-based tool access**: Different users/clients need different tool catalogs based on their roles or permissions.
```

---

#### Step 2.4: Update README - Add to "Why Toolception helps"
**File:** `README.md`

**Location:** After line ~51 in "Why Toolception helps" section

**Addition:**
```markdown
- **Per-client configuration**:
  - Use `createPermissionBasedMcpServer` for permission-based toolset access.
  - Each client receives only the toolsets they're authorized to use.
  - Combines per-client isolation with pre-loaded, client-specific tool catalogs.
```

---

#### Step 2.5: Update README - Add to Starter Guide
**File:** `README.md`

**Location:** New section after Step 8 (line ~157)

**Addition:**
```markdown
### Step 9 (Optional): Permission-based toolset access

For scenarios where different clients should have access to different toolsets based on their permissions, use the dedicated `createPermissionBasedMcpServer` function:

```ts
import { createPermissionBasedMcpServer } from "toolception";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// YOUR APPLICATION'S permission lookup logic
// (This is YOUR code, not the library's code)
interface ClientPermissions {
  allowedToolsets: string[];
}

async function getClientPermissions(clientId: string): Promise<ClientPermissions> {
  // Your auth logic: database lookup, JWT decode, API call, etc.
  // The library calls this function with the clientId from the HTTP header
  const user = await yourDatabase.users.findById(clientId);
  const role = await yourAuthService.getRole(user);
  
  if (role === "admin") {
    return { allowedToolsets: ["core", "admin", "analytics"] };
  }
  return { allowedToolsets: ["core"] };
}

const { start, close } = await createPermissionBasedMcpServer({
  catalog,
  moduleLoaders,
  http: { port: 3000 },
  
  // YOUR CALLBACK: Library calls this when client first connects
  // clientId comes from the "mcp-client-id" HTTP header sent by the client
  createServerForClient: async (clientId: string) => {
    // YOUR CODE: Look up permissions for this client
    const permissions = await getClientPermissions(clientId);
    
    return {
      server: new McpServer({
        name: `server-${clientId}`,
        version: "1.0.0",
        capabilities: { tools: { listChanged: false } },
      }),
      toolsets: permissions.allowedToolsets, // Pre-loaded in STATIC mode
      exposurePolicy: {
        namespaceToolsWithSetKey: true,
      },
    };
  },
});
```

**How clients connect:**
```ts
// Client sends their identity in the HTTP header
const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: { 
      headers: { "mcp-client-id": "user-123" } // Library uses this
    }
  }
);
```

This pattern provides:
- **Security**: Permissions enforced at bundle creation time (first connection)
- **Performance**: Tools pre-loaded in STATIC mode, no runtime overhead
- **Simplicity**: Clients get direct access to their tools (no meta-tools)
- **Isolation**: Complete separation between client bundles
- **Deterministic**: Each client's toolset is fixed at connection time
- **Flexible**: You control the permission lookup logic entirely
```

---

### Phase 3: Testing

#### Step 3.1: Verify Existing Tests Pass
**Command:** `npm run test`

**Expected:** All existing tests pass without modification.

**Why:** Confirms backward compatibility.

---

#### Step 3.2: Add Unit Tests
**File:** `tests/createPermissionBasedMcpServer.test.ts` (NEW)

**New Tests:**
1. `should create permission-based server with createServerForClient`
2. `should pass clientId to createServerForClient factory`
3. `should throw error when createServerForClient is not provided`
4. `should create different bundles with different toolsets for different clients`
5. `should support N toolsets (1, 2, 5, 10 toolsets)`
6. `should support "ALL" toolsets option`
7. `should support empty toolsets array (no tools)`
8. `should use client-specific exposurePolicy when provided`
9. `should enforce STATIC mode and pre-load toolsets at bundle creation`
10. `should not register meta-tools in client bundles`
11. `should handle async permission lookups in createServerForClient`
12. `should work when clientId parameter is ignored (static assignment)`

---

#### Step 3.3: Manual Testing with Demo
**Steps:**
1. Run permission-based demo server: `npm run dev:permission-demo`
2. Test with admin client (5 toolsets): `MCP_CLIENT_ID="admin-123" npm run dev:client-demo`
3. Test with power user client (3 toolsets): `MCP_CLIENT_ID="power-456" npm run dev:client-demo`
4. Test with user client (2 toolsets): `MCP_CLIENT_ID="user-789" npm run dev:client-demo`
5. Test with guest client (1 toolset): `MCP_CLIENT_ID="guest-000" npm run dev:client-demo`
6. Verify each client sees only their allowed tools

**Verification Checklist (STATIC Mode):**
- ✅ Each client's tools are pre-loaded at connection time
- ✅ No `enable_toolset` or `disable_toolset` meta-tools present
- ✅ Clients can immediately call their permitted tools (e.g., `core.ping`, `admin.deleteUser`)
- ✅ Different clients see different tool lists based on permissions
- ✅ Tools are namespaced with toolset key (e.g., `core.ping` not just `ping`)

**N Toolsets Verification:**
- ✅ Admin sees 5 toolsets: core, admin, analytics, billing, audit
- ✅ Power user sees 3 toolsets: core, analytics, reports
- ✅ User sees 2 toolsets: core, reports
- ✅ Guest sees 1 toolset: core
- ✅ Each client has different number of tools available

---

### Phase 4: Final Checks

#### Step 4.1: Type Checking
**Command:** `npm run typecheck`

**Expected:** No type errors.

---

#### Step 4.2: Build
**Command:** `npm run build`

**Expected:** Clean build with all exports in `dist/`.

---

#### Step 4.3: Coverage
**Command:** `npm run test:coverage`

**Expected:** Coverage maintained or improved.

---

## Files Modified Summary

### Modified Files (5)
1. `src/http/FastifyTransport.ts` - Make bundle factory explicitly async
2. `src/server/createMcpServer.ts` - Wrap existing factory in async (minimal change)
3. `src/index.ts` - Export new function and types
4. `README.md` - Document new feature
5. `package.json` - Add demo script

### New Files (4)
1. `src/server/createPermissionBasedMcpServer.ts` - New permission-based function
2. `tests/createPermissionBasedMcpServer.test.ts` - Unit tests for new function
3. `tests/smoke-e2e/permission-based-demo.ts` - Working demo
4. `PLAN.md` - This file (can be archived after implementation)

## Backward Compatibility Checklist

✅ Existing `createServer` option still works  
✅ All existing tests pass  
✅ No changes to existing function signatures (only additions)  
✅ New option is optional  
✅ Default behavior unchanged  
✅ No breaking changes to exports  

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing API | Low | High | Thorough testing, backward-compatible design |
| Type errors | Low | Medium | TypeScript validation, type tests |
| Performance regression | Very Low | Medium | Minimal code changes, existing patterns |
| Documentation gaps | Low | Low | Comprehensive README updates |

## Success Criteria

- [ ] All existing tests pass
- [ ] New tests pass
- [ ] Demo works for all client types
- [ ] TypeScript compilation succeeds
- [ ] README clearly documents new feature
- [ ] No breaking changes to public API
- [ ] Code coverage maintained

## Timeline Estimate

- Phase 1 (Core Implementation): ~2 hours
- Phase 2 (Documentation): ~1 hour
- Phase 3 (Testing): ~1.5 hours
- Phase 4 (Final Checks): ~30 minutes

**Total:** ~5 hours

## Post-Implementation

After successful implementation and testing:
1. Archive this PLAN.md file
2. Update CHANGELOG.md with new feature
3. Bump version to 0.3.0 (minor version - new feature, no breaking changes)
4. Create PR for review
5. Merge to main after approval

---

## Quick Reference Summary

### What's Being Added
- **New Function:** `createPermissionBasedMcpServer`
- **New Interface:** `CreatePermissionBasedMcpServerOptions`
- **Demo:** Permission-based server example with multiple client roles
- **STATIC Mode Only:** First step - pre-loaded toolsets, no runtime changes

### What's Being Modified (Minimal)
- `FastifyTransport`: Make bundle factory explicitly async
- `createMcpServer`: Wrap factory in async (backward compatible)
- `README`: Add permission-based use case and setup guide

### Key API Example (STATIC Mode)
```typescript
import { createPermissionBasedMcpServer } from "toolception";

const { start, close } = await createPermissionBasedMcpServer({
  catalog: { /* toolsets */ },
  moduleLoaders: { /* loaders */ },
  http: { port: 3000 },
  
  createServerForClient: async (clientId) => {
    const permissions = await getPermissions(clientId);
    return {
      server: new McpServer({ /* ... */ }),
      toolsets: permissions.allowedToolsets, // Pre-loaded in STATIC mode
      exposurePolicy: { namespaceToolsWithSetKey: true }
    };
  }
});
```

**Note:** This function enforces STATIC mode:
- ✅ Toolsets pre-loaded at connection time
- ✅ No meta-tools registered
- ✅ No runtime enable/disable
- ✅ Simple, secure, performant

### Zero Breaking Changes ✅
- Existing `createMcpServer` unchanged
- All existing tests pass
- Backward compatibility guaranteed

