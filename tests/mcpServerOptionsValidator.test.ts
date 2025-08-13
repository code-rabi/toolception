import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerOptionsValidator } from "../src/server/validateOptions.js";

function fakeServer() {
  return { tool() {} } as any;
}

describe("McpServerOptionsValidator", () => {
  const originalEmitWarning = process.emitWarning;

  beforeEach(() => {
    // @ts-expect-error allow spy replacement
    process.emitWarning = vi.fn();
  });

  afterEach(() => {
    // @ts-expect-error restore type
    process.emitWarning = originalEmitWarning;
  });

  it("throws when neither server nor createServer provided", () => {
    expect(() =>
      McpServerOptionsValidator.validate({ startup: { mode: "DYNAMIC" } })
    ).toThrow(/either `server` or `createServer`/);
  });

  it("throws in DYNAMIC mode without createServer", () => {
    expect(() =>
      McpServerOptionsValidator.validate({
        server: fakeServer(),
        startup: { mode: "DYNAMIC" },
      })
    ).toThrow(/DYNAMIC mode `createServer` is required/);
  });

  it("warns when both server and createServer provided", () => {
    McpServerOptionsValidator.validate({
      server: fakeServer(),
      createServer: () => fakeServer(),
      startup: { mode: "STATIC" },
    });
    expect(process.emitWarning).toHaveBeenCalled();
  });

  it("passes when STATIC with only server", () => {
    expect(() =>
      McpServerOptionsValidator.validate({
        server: fakeServer(),
        startup: { mode: "STATIC" },
      })
    ).not.toThrow();
  });

  it("passes when DYNAMIC with createServer", () => {
    expect(() =>
      McpServerOptionsValidator.validate({
        createServer: () => fakeServer(),
        startup: { mode: "DYNAMIC" },
      })
    ).not.toThrow();
  });
});
