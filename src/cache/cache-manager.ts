/**
 * In-memory TTL + LRU cache with configurable max entries.
 *
 * Eviction strategy:
 *  1. Expired entries are removed on access and during eviction sweeps.
 *  2. When the cache exceeds `maxEntries`, the least-recently-used
 *     non-expired entry is evicted first.
 */

/** TTL presets (milliseconds) for common GSC data types. */
export const CACHE_TTL = {
  /** Analytics data older than 2 days is finalized by Google. */
  ANALYTICS_FINAL: 3_600_000, // 1 hour
  /** Recent analytics data that may still change. */
  ANALYTICS_FRESH: 900_000, // 15 minutes
  /** Site list / site metadata. */
  SITES: 1_800_000, // 30 minutes
  /** Sitemap data. */
  SITEMAPS: 900_000, // 15 minutes
  /** URL inspection results (stable once fetched). */
  URL_INSPECTION: 3_600_000, // 1 hour
} as const;

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

const DEFAULT_MAX_ENTRIES = 500;

export class CacheManager {
  /**
   * Internal store. We rely on `Map` iteration order (insertion order) and
   * re-insert entries on access so that the *first* key returned by the
   * iterator is always the least-recently-used entry.
   */
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;

  private hits = 0;
  private misses = 0;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (maxEntries < 1) {
      throw new RangeError("maxEntries must be at least 1");
    }
    this.maxEntries = maxEntries;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a cached value. Returns `undefined` on miss or expiry.
   * A successful hit refreshes the entry's LRU position.
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);

    if (entry === undefined) {
      this.misses++;
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to end (most-recently-used) by re-inserting.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;

    return entry.value as T;
  }

  /**
   * Store a value with a time-to-live in milliseconds.
   * If the cache is full the least-recently-used entry is evicted first.
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    // If the key already exists, delete first so re-insertion moves it to the end.
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict if necessary *before* inserting.
    this.evictIfNeeded();

    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
    };

    this.store.set(key, entry);
  }

  /** Remove a single key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate every key that starts with `prefix`.
   * Useful for busting all analytics entries for a specific site, etc.
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Drop all entries and reset statistics. */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Return current cache statistics. */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() >= entry.expiresAt;
  }

  /**
   * Ensure there is room for at least one new entry.
   * First purges any expired entries; if still over capacity, evicts the
   * least-recently-used (first key in the Map).
   */
  private evictIfNeeded(): void {
    if (this.store.size < this.maxEntries) {
      return;
    }

    // Pass 1 – remove expired entries.
    for (const [key, entry] of this.store) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
      }
    }

    // Pass 2 – if still at capacity, evict LRU entries.
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      } else {
        break;
      }
    }
  }
}
