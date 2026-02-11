export interface SessionContextResult {
  /**
   * The merged context to pass to module loaders.
   */
  context: unknown;

  /**
   * A deterministic hash suffix based on the session config values.
   * Used to differentiate cache entries: `${clientId}:${cacheKeySuffix}`
   * Returns 'default' when no session config is present.
   */
  cacheKeySuffix: string;
}

export interface ClientResourceCacheOptions<T> {
  maxSize?: number;
  ttlMs?: number;
  pruneIntervalMs?: number;
  /**
   * Optional cleanup callback called when a resource is removed from the cache.
   * Use this to close connections, clean up sessions, etc.
   * @param key - The cache key being removed
   * @param resource - The resource being removed
   */
  onEvict?: (key: string, resource: T) => void | Promise<void>;
}

export interface Entry<T> {
  resource: T;
  lastAccessed: number;
}
