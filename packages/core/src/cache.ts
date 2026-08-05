import type { CacheApi } from './types.js'

export class TTLCache implements CacheApi {
  private store = new Map<string, { expiresAt: number; value: unknown }>()

  constructor(private ttlMs = 5 * 60_000) {}

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return hit.value as T
  }

  set<T>(key: string, value: T, ttlMs = this.ttlMs): void {
    this.store.set(key, { expiresAt: Date.now() + ttlMs, value })
  }

  async withCache<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key)
    if (hit !== undefined) return hit
    const value = await compute()
    this.set(key, value, ttlMs)
    return value
  }

  clear(): void {
    this.store.clear()
  }
}
