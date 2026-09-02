interface Entry<T> { expiresAt: number; value: T }

export class LiveResultCache {
  private readonly values = new Map<string, Entry<unknown>>();
  private readonly ttlMs:number;private readonly maxEntries:number;
  constructor(ttlMs = 5 * 60_000, maxEntries = 250) {this.ttlMs=ttlMs;this.maxEntries=maxEntries;}

  get<T>(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.values.delete(key); return undefined; }
    return entry.value as T;
  }

  set<T>(key: string, value: T): T {
    if (this.values.size >= this.maxEntries) this.values.delete(this.values.keys().next().value as string);
    this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }
}

export const liveResultCache = new LiveResultCache();
