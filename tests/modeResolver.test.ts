import { describe, it, expect } from "vitest";
import { ToolsetValidator } from "../src/mode/ModeResolver.js";

describe("ToolsetValidator", () => {
  it("detects dynamic from args/env", () => {
    const r = new ToolsetValidator();
    expect(r.resolveMode(undefined, { DYNAMIC_TOOL_DISCOVERY: "true" })).toBe(
      "DYNAMIC"
    );
    expect(r.resolveMode({ DYNAMIC_TOOL_DISCOVERY: "true" }, undefined)).toBe(
      "DYNAMIC"
    );
  });

  it("detects static when toolsets present", () => {
    const r = new ToolsetValidator();
    expect(r.resolveMode(undefined, { FMP_TOOL_SETS: "a,b" })).toBe("STATIC");
    expect(r.resolveMode({ FMP_TOOL_SETS: "a" }, undefined)).toBe("STATIC");
  });

  it("parses comma separated toolsets and validates", () => {
    const r = new ToolsetValidator();
    const catalog = { a: {} as any, b: {} as any };
    expect(r.parseCommaSeparatedToolSets("a,b,c", catalog as any)).toEqual([
      "a",
      "b",
    ]);
  });
});
