import { describe, it, expect, vi } from "vitest";

const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock("@modelcontextprotocol/server/validators/ajv", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@modelcontextprotocol/server/validators/ajv")>();
  return {
    ...original,
    AjvJsonSchemaValidator: class extends original.AjvJsonSchemaValidator {
      constructor() {
        super();
        constructed.count += 1;
      }
    },
  };
});

import { McpServer } from "@modelcontextprotocol/server";
import { DynamicToolManager } from "../src/core/DynamicToolManager.js";
import { ModuleResolver } from "../src/mode/ModuleResolver.js";

/**
 * JSON Schema validators hold every compiled schema for their lifetime, so each
 * client's manager must own one instead of sharing a process-wide validator.
 */
describe("JSON Schema validator scope", () => {
  function newManager() {
    return new DynamicToolManager({
      server: new McpServer({ name: "t", version: "1.0.0" }),
      resolver: new ModuleResolver({ catalog: {} }),
    });
  }

  it("creates one validator per manager, not one per process or per tool", () => {
    const before = constructed.count;
    newManager();
    newManager();
    expect(constructed.count - before).toBe(2);
  });
});
