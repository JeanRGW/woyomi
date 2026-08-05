import { describe, expect, it } from 'vitest'
import { exampleVideoSource } from '../src/examplevideo.js'
import type { FetchFn } from '@media-platform/core'

const ctx = {
  cache: {
    async withCache<T>(_k: string, _t: number, compute: () => Promise<T>): Promise<T> {
      return compute()
    }
  }
}

const fetch: FetchFn = async () => ({ status: 200, headers: {}, body: '' })

describe('examplevideo source', () => {
  it('searches and filters by query', async () => {
    const all = await exampleVideoSource.search({ ...ctx, fetch }, '', 1)
    const filtered = await exampleVideoSource.search({ ...ctx, fetch }, 'paper', 1)
    expect(all.items.length).toBeGreaterThan(0)
    expect(filtered.items.map((m) => m.title).every((t) => t === 'Paper Moons')).toBe(true)
    expect(filtered.items[0]?.type).toBe('series')
  })

  it('yields 12 seasonal episodes', async () => {
    const eps = await exampleVideoSource.getEpisodes({ ...ctx, fetch }, '1')
    expect(eps).toHaveLength(12)
    expect(eps[0]?.season).toBe(1)
    expect(eps[11]?.number).toBe(12)
  })

  it('returns HLS streams', async () => {
    const media = await exampleVideoSource.getMedia({ ...ctx, fetch }, '1')
    const eps = await exampleVideoSource.getEpisodes({ ...ctx, fetch }, '1')
    const streams = await exampleVideoSource.getStreams!({ ...ctx, fetch }, media, eps[0]!)
    expect(streams[0]?.kind).toBe('hls')
    expect(streams[0]?.url).toContain('m3u8')
  })
})
