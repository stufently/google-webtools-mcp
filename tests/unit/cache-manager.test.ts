import { CacheManager, CACHE_TTL } from '../../src/cache/cache-manager.js';

describe('CacheManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('set / get', () => {
    it('stores and retrieves a value', () => {
      const cache = new CacheManager();
      cache.set('key1', 'value1', 60_000);
      expect(cache.get('key1')).toBe('value1');
    });

    it('returns undefined for a missing key', () => {
      const cache = new CacheManager();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('stores objects and preserves reference equality', () => {
      const cache = new CacheManager();
      const obj = { a: 1, b: [2, 3] };
      cache.set('obj', obj, 60_000);
      expect(cache.get('obj')).toBe(obj);
    });

    it('overwrites existing key with new value', () => {
      const cache = new CacheManager();
      cache.set('key', 'first', 60_000);
      cache.set('key', 'second', 60_000);
      expect(cache.get('key')).toBe('second');
    });
  });

  describe('TTL expiry', () => {
    it('returns undefined after TTL expires', () => {
      const cache = new CacheManager();
      cache.set('key', 'value', 1000);

      vi.advanceTimersByTime(999);
      expect(cache.get('key')).toBe('value');

      vi.advanceTimersByTime(1);
      expect(cache.get('key')).toBeUndefined();
    });

    it('respects different TTL values', () => {
      const cache = new CacheManager();
      cache.set('short', 'a', 500);
      cache.set('long', 'b', 2000);

      vi.advanceTimersByTime(500);
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('b');

      vi.advanceTimersByTime(1500);
      expect(cache.get('long')).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry when max entries exceeded', () => {
      const cache = new CacheManager(3);
      cache.set('a', 1, 60_000);
      cache.set('b', 2, 60_000);
      cache.set('c', 3, 60_000);

      // Adding a 4th entry should evict 'a' (LRU)
      cache.set('d', 4, 60_000);

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('accessing an entry refreshes its LRU position', () => {
      const cache = new CacheManager(3);
      cache.set('a', 1, 60_000);
      cache.set('b', 2, 60_000);
      cache.set('c', 3, 60_000);

      // Access 'a' to make it most-recently-used
      cache.get('a');

      // Now 'b' is the LRU; adding 'd' should evict 'b'
      cache.set('d', 4, 60_000);

      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('evicts expired entries before LRU eviction', () => {
      const cache = new CacheManager(3);
      cache.set('a', 1, 500);
      cache.set('b', 2, 60_000);
      cache.set('c', 3, 60_000);

      vi.advanceTimersByTime(500);

      // 'a' is now expired; adding 'd' should purge 'a' first, no LRU eviction of 'b' needed
      cache.set('d', 4, 60_000);

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('delete', () => {
    it('removes a specific key', () => {
      const cache = new CacheManager();
      cache.set('key', 'value', 60_000);
      cache.delete('key');
      expect(cache.get('key')).toBeUndefined();
    });

    it('does not throw when deleting a non-existent key', () => {
      const cache = new CacheManager();
      expect(() => cache.delete('nope')).not.toThrow();
    });
  });

  describe('invalidatePrefix', () => {
    it('removes all keys starting with the given prefix', () => {
      const cache = new CacheManager();
      cache.set('site:example.com:analytics', 1, 60_000);
      cache.set('site:example.com:sitemaps', 2, 60_000);
      cache.set('site:other.com:analytics', 3, 60_000);
      cache.set('global:config', 4, 60_000);

      cache.invalidatePrefix('site:example.com');

      expect(cache.get('site:example.com:analytics')).toBeUndefined();
      expect(cache.get('site:example.com:sitemaps')).toBeUndefined();
      expect(cache.get('site:other.com:analytics')).toBe(3);
      expect(cache.get('global:config')).toBe(4);
    });

    it('does nothing when no keys match', () => {
      const cache = new CacheManager();
      cache.set('key', 'value', 60_000);
      cache.invalidatePrefix('nomatch');
      expect(cache.get('key')).toBe('value');
    });
  });

  describe('clear', () => {
    it('removes all entries and resets stats', () => {
      const cache = new CacheManager();
      cache.set('a', 1, 60_000);
      cache.set('b', 2, 60_000);
      cache.get('a');
      cache.get('missing');

      cache.clear();

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();

      const stats = cache.stats();
      // After clear, only the two gets above (both misses) should count
      expect(stats.size).toBe(0);
      // hits and misses were reset by clear; the two gets after clear are misses
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
    });
  });

  describe('stats', () => {
    it('tracks hits and misses correctly', () => {
      const cache = new CacheManager();
      cache.set('a', 1, 60_000);

      cache.get('a'); // hit
      cache.get('a'); // hit
      cache.get('b'); // miss

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.size).toBe(1);
    });

    it('returns 0 hitRate when no gets have been called', () => {
      const cache = new CacheManager();
      expect(cache.stats().hitRate).toBe(0);
    });

    it('counts expired gets as misses', () => {
      const cache = new CacheManager();
      cache.set('key', 'val', 100);

      vi.advanceTimersByTime(100);
      cache.get('key'); // miss (expired)

      expect(cache.stats().misses).toBe(1);
      expect(cache.stats().hits).toBe(0);
    });
  });

  describe('constructor validation', () => {
    it('throws if maxEntries is less than 1', () => {
      expect(() => new CacheManager(0)).toThrow(RangeError);
      expect(() => new CacheManager(-1)).toThrow(RangeError);
    });
  });

  describe('CACHE_TTL constants', () => {
    it('exports expected TTL values', () => {
      expect(CACHE_TTL.ANALYTICS_FINAL).toBe(3_600_000);
      expect(CACHE_TTL.ANALYTICS_FRESH).toBe(900_000);
      expect(CACHE_TTL.SITES).toBe(1_800_000);
      expect(CACHE_TTL.SITEMAPS).toBe(900_000);
      expect(CACHE_TTL.URL_INSPECTION).toBe(3_600_000);
    });
  });
});
