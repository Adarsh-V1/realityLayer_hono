/**
 * Simple in-memory TTL cache.
 * Keys are evicted on read if expired, and periodically swept.
 */
export class MemoryCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(private defaultTtlMs: number = 60_000) {
    // Sweep expired entries every 30s
    this.sweepTimer = setInterval(() => this.sweep(), 30_000);
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  invalidate(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    this.store.clear();
  }
}
