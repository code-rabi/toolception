import { describe, it, expect } from "vitest";
import { ClientResourceCache } from "../src/session/ClientResourceCache.js";

describe("ClientResourceCache", () => {
  it("stores and retrieves with LRU semantics", () => {
    const cache = new ClientResourceCache<string>({ maxSize: 2, ttlMs: 1000 });
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");
    // LRU eviction should have removed "b"
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });

  it("expires by ttl", async () => {
    const cache = new ClientResourceCache<string>({
      ttlMs: 5,
      pruneIntervalMs: 1000,
    });
    cache.set("k", "V");
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get("k")).toBeNull();
    cache.stop();
  });
});
