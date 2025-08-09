export interface ClientResourceCacheOptions {
  maxSize?: number;
  ttlMs?: number; // ms
  pruneIntervalMs?: number;
}

interface Entry<T> {
  resource: T;
  lastAccessed: number;
}

export class ClientResourceCache<T> {
  private storage = new Map<string, Entry<T>>();
  private maxSize: number;
  private ttlMs: number;
  // Use ReturnType<typeof setInterval> for cross-env typings without NodeJS namespace
  private pruneInterval?: ReturnType<typeof setInterval>;

  constructor(options: ClientResourceCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttlMs = options.ttlMs ?? 1000 * 60 * 60;
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

  public delete(key: string): void {
    this.storage.delete(key);
  }

  public stop(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
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
    for (const [key, entry] of this.storage.entries()) {
      if (now - entry.lastAccessed > this.ttlMs) {
        this.delete(key);
      }
    }
  }
}
