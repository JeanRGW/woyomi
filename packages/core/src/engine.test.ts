import { describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.js'
import type { HomeSection, SearchResults, Source, SourceContext } from '../src/types.js'

function makeFetch(body: string, status = 200) {
  return async () => ({ status, headers: {}, body })
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'test',
    name: 'Test',
    mediaTypes: ['manga'],
    async search(ctx: SourceContext, query, page): Promise<SearchResults> {
      const res = await ctx.fetch(`http://x/${query}/${page}`)
      return { page, hasNextPage: false, items: JSON.parse(res.body) }
    },
    async getMedia() {
      throw new Error('not impl')
    },
    async getEpisodes() {
      return []
    },
    async getChapterContent() {
      return { type: 'text', html: '<p>x</p>' }
    },
    ...overrides
  }
}

describe('Engine', () => {
  it('routes through injected fetch and throttles', async () => {
    const calls: string[] = []
    const fetch = async (url: string) => {
      calls.push(url)
      return { status: 200, headers: {}, body: '[{"id":"t/1","title":"T","mediaId":"1","sourceId":"test","type":"manga"}]' }
    }
    const engine = new Engine({ fetch, sourceThrottleMs: 100 })
    engine.registerSource(makeSource())
    const r = await engine.search('test', 'a', 1)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.title).toBe('T')
    expect(calls).toEqual(['http://x/a/1'])
  })

  it('dedupes concurrent identical calls', async () => {
    let calls = 0
    const fetch = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 20))
      return { status: 200, headers: {}, body: '[]' }
    }
    const engine = new Engine({ fetch, sourceThrottleMs: 0 })
    engine.registerSource(makeSource())
    await Promise.all([engine.search('test', 'a', 1), engine.search('test', 'a', 1)])
    expect(calls).toBe(1)
  })

  it('throws for unknown source', async () => {
    const engine = new Engine({ fetch: makeFetch(''), sourceThrottleMs: 0 })
    await expect(engine.search('nope', 'q', 1)).rejects.toThrow('unknown source')
  })

  it('searchAll groups results per source and tolerates failures', async () => {
    const ok = makeSource({
      id: 'ok',
      async search() {
        return { page: 1, hasNextPage: false, items: [{ id: 'ok/1', title: 'O', mediaId: '1', sourceId: 'ok', type: 'manga' }] }
      }
    })
    const bad = makeSource({
      id: 'bad',
      name: 'Bad',
      async search() {
        throw new Error('boom')
      }
    })
    const engine = new Engine({ fetch: makeFetch(''), sourceThrottleMs: 0 })
    engine.registerSource(ok)
    engine.registerSource(bad)
    const results = await engine.searchAll('q', 1)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ sourceId: 'ok', items: [{ title: 'O' }] })
    expect(results[1]).toMatchObject({ sourceId: 'bad', items: [], hasNextPage: false })
    expect(results[1]?.error).toContain('boom')
  })

  it('searchAll keeps a failing source from blocking the aggregate', async () => {
    const engine = new Engine({ fetch: makeFetch(''), sourceThrottleMs: 0 })
    engine.registerSource(
      makeSource({
        id: 'a',
        async search() {
          return { page: 1, hasNextPage: false, items: [] }
        }
      })
    )
    engine.registerSource(
      makeSource({
        id: 'b',
        async search() {
          throw new Error('down')
        }
      })
    )
    const results = await engine.searchAll('q', 1)
    expect(results[0]?.sourceId).toBe('a')
    expect(results[1]?.error).toContain('down')
  })

  it('hasHome/getHomeSections/getHomeSection route through the source', async () => {
    const home: HomeSection[] = [{ id: 'latest', title: 'Latest' }]
    const source = makeSource({
      async getHomeSections() {
        return home
      },
      async getHomeSection(_ctx, sectionId) {
        return { page: 1, hasNextPage: false, items: [{ id: 'test/x', title: sectionId, mediaId: 'x', sourceId: 'test', type: 'manga' }] }
      }
    })
    const engine = new Engine({ fetch: makeFetch(''), sourceThrottleMs: 0 })
    engine.registerSource(source)
    expect(engine.hasHome('test')).toBe(true)
    expect(await engine.getHomeSections('test')).toEqual(home)
    const r = await engine.getHomeSection('test', 'latest', 1)
    expect(r.items[0]?.title).toBe('latest')
  })

  it('hasHome/getHomeSection throw for sources without a homepage', async () => {
    const engine = new Engine({ fetch: makeFetch(''), sourceThrottleMs: 0 })
    engine.registerSource(makeSource())
    expect(engine.hasHome('test')).toBe(false)
    await expect(engine.getHomeSections('test')).rejects.toThrow('no homepage')
    await expect(engine.getHomeSection('test', 'x', 1)).rejects.toThrow('no homepage')
  })

  it('binds ctx.preferences to the owning plugin id', async () => {
    const seen: string[] = []
    const prefs = {
      async get<T>(pluginId: string, key: string): Promise<T | undefined> {
        seen.push(`get:${pluginId}:${key}`)
        return undefined
      },
      async getWithDefault<T>(pluginId: string, key: string, fallback: T): Promise<T> {
        seen.push(`default:${pluginId}:${key}`)
        return fallback
      },
      async set() {}
    }
    const source = makeSource({
      id: 'child',
      async getMedia(ctx) {
        await ctx.preferences.getWithDefault('foo', 'x')
        return { id: 'child/1', title: 'c', mediaId: '1', sourceId: 'child', type: 'manga' }
      }
    })
    const engine = new Engine({ fetch: makeFetch(''), sourceThrottleMs: 0, sourcePrefs: prefs })
    engine.registerSource(source, 'my-plugin')
    await engine.getMedia('child', '1')
    expect(seen).toEqual(['default:my-plugin:foo'])
  })
})
