import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * toolception wraps tool schemas with its own `zod` and hands them to the SDK,
 * so a second copy of `zod` or `@modelcontextprotocol/server` in the tree would
 * make `instanceof` and schema detection fail in ways that only show at runtime.
 */
interface Lockfile {
  readonly packages: Record<string, { readonly version?: string }>;
}

const lockfile = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")
) as Lockfile;

/** @returns Every lockfile path of the named package, nested copies included */
function copiesOf(name: string): string[] {
  return Object.keys(lockfile.packages).filter(
    (path) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)
  );
}

describe("dependency tree", () => {
  it.each(["zod", "@modelcontextprotocol/server", "@modelcontextprotocol/core"])(
    "has exactly one copy of %s",
    (name) => {
      expect(copiesOf(name)).toEqual([`node_modules/${name}`]);
    }
  );

  it("resolves Zod 4 and SDK v2", () => {
    expect(lockfile.packages["node_modules/zod"]?.version).toMatch(/^4\./);
    expect(
      lockfile.packages["node_modules/@modelcontextprotocol/server"]?.version
    ).toMatch(/^2\./);
  });
});
