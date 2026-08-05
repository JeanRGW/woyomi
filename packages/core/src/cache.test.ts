import { describe, expect, it } from 'vitest'
import { TTLCache } from '../src/cache.js'

describe('TTLCache', () => {
  it('caches within TTL', async () => {
    const cache = new TTLCache(1000)
    let calls = 0
    const fn = () => cache.withCache('k', 1000, async () => ++calls)
    await fn()
    await fn()
    expect(calls).toBe(1)
  })

  it('expires after TTL', async () => {
    const cache = new TTLCache(10)
    let calls = 0
    const fn = () => cache.withCache('k', 10, async () => ++calls)
    await fn()
    await new Promise((r) => setTimeout(r, 30))
    await fn()
    expect(calls).toBe(2)
  })

  it('survives rejections without poisoning the cache', async () => {
    const cache = new TTLCache(1000)
    let calls = 0
    await expect(
      cache.withCache('k', 1000, async () => {
        calls++
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await cache.withCache('k', 1000, async () => (calls++))
    expect(calls).toBe(2)
  })
})
