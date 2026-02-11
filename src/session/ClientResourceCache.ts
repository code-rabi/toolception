import type { ClientResourceCacheOptions, Entry } from "./session.types.js";

export class ClientResourceCache<T> {
  private storage = new Map<string, Entry<T>>();
  private maxSize: number;
  private ttlMs: number;
  private onEvict?: (key: string, resource: T) => void | Promise<void>;
  // Use ReturnType<typeof setInterval> for cross-env typings without NodeJS namespace
  private pruneInterval?: ReturnType<typeof setInterval>;

  constructor(options: ClientResourceCacheOptions<T> = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttlMs = options.ttlMs ?? 1000 * 60 * 60;
    this.onEvict = options.onEvict;
    const pruneEvery = options.pruneIntervalMs ?? 1000 * 60 * 10;
    this.pruneInterval = setInterval(() => this.pruneExpired(), pruneEvery);
  }

  static builder<T>() {
    const opts: ClientResourceCacheOptions<T> = {};
    const builder = {
      maxSize(value: number) { opts.maxSize = value; return builder; },
      ttlMs(value: number) { opts.ttlMs = value; return builder; },
      pruneIntervalMs(value: number) { opts.pruneIntervalMs = value; return builder; },
      onEvict(value: (key: string, resource: T) => void | Promise<void>) { opts.onEvict = value; return builder; },
      build() { return new ClientResourceCache<T>(opts); },
    };
    return builder;
  }

  public getEntryCount(): number {
    return this.storage.size;
  }

  public getMaxSize(): number {
    return this.maxSize;
  }

  public getTtl(): number {
    return this.ttlMs;
  }

  public get(key: string): T | null {
    const entry = this.storage.get(key);
    if (!entry) return null;
    if (Date.now() - entry.lastAccessed > this.ttlMs) {
      this.delete(key);
      return null;
    }
    entry.lastAccessed = Date.now();
    this.storage.delete(key);
    this.storage.set(key, entry);
    return entry.resource;
  }

  public set(key: string, resource: T): void {
    if (this.storage.size >= this.maxSize) {
      this.evictLeastRecentlyUsed();
    }
    const newEntry: Entry<T> = { resource, lastAccessed: Date.now() };
    this.storage.set(key, newEntry);
  }

  /**
   * @param key - The key to remove
   */
  public delete(key: string): void {
    const entry = this.storage.get(key);
    if (entry) {
      this.storage.delete(key);
      this.#callEvictCallback(key, entry.resource);
    }
  }

  /**
   * @param clearEntries - If true, also removes all entries and calls onEvict for each
   */
  public stop(clearEntries = false): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }
    if (clearEntries) {
      this.clear();
    }
  }

  public clear(): void {
    // Collect all entries first to avoid modification during iteration
    const entries = Array.from(this.storage.entries());
    this.storage.clear();
    for (const [key, entry] of entries) {
      this.#callEvictCallback(key, entry.resource);
    }
  }

  private evictLeastRecentlyUsed(): void {
    const lruKey = this.storage.keys().next().value as string | undefined;
    if (lruKey) {
      this.delete(lruKey);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.storage.entries()) {
      if (now - entry.lastAccessed > this.ttlMs) {
        keysToDelete.push(key);
      }
    }
    // Delete after iteration to avoid modification during iteration
    for (const key of keysToDelete) {
      this.delete(key);
    }
  }

  /**
   * @param key - The key being evicted
   * @param resource - The resource being evicted
   */
  #callEvictCallback(key: string, resource: T): void {
    if (!this.onEvict) return;
    try {
      const result = this.onEvict(key, resource);
      // Handle async callbacks but don't await
      if (result instanceof Promise) {
        result.catch((err) => {
          console.warn(`Error in cache eviction callback for key '${key}':`, err);
        });
      }
    } catch (err) {
      console.warn(`Error in cache eviction callback for key '${key}':`, err);
    }
  }
}
