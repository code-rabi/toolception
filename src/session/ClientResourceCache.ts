export interface ClientResourceCacheOptions<T> {
  maxSize?: number;
  ttlMs?: number; // ms
  pruneIntervalMs?: number;
  /**
   * Optional cleanup callback called when a resource is removed from the cache.
   * Use this to close connections, clean up sessions, etc.
   * @param key - The cache key being removed
   * @param resource - The resource being removed
   */
  onEvict?: (key: string, resource: T) => void | Promise<void>;
}

interface Entry<T> {
  resource: T;
  lastAccessed: number;
}

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
   * Removes an entry from the cache.
   * Calls the onEvict callback if configured.
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
   * Stops the background pruning interval and optionally clears all entries.
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

  /**
   * Clears all entries from the cache.
   * Calls onEvict for each entry being removed.
   */
  public clear(): void {
    // Collect all entries first to avoid modification during iteration
    const entries = Array.from(this.storage.entries());
    this.storage.clear();
    for (const [key, entry] of entries) {
      this.#callEvictCallback(key, entry.resource);
    }
  }

  /**
   * Evicts the least recently used entry from the cache.
   * @private
   */
  private evictLeastRecentlyUsed(): void {
    const lruKey = this.storage.keys().next().value as string | undefined;
    if (lruKey) {
      this.delete(lruKey);
    }
  }

  /**
   * Removes all expired entries from the cache.
   * @private
   */
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
   * Safely calls the evict callback, catching and logging any errors.
   * @param key - The key being evicted
   * @param resource - The resource being evicted
   * @private
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
