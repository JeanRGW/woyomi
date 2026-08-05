import { describe, expect, it, vi } from 'vitest'
import { mangaDexSource } from '../src/mangadex.js'
import type { FetchFn } from '@media-platform/core'

const searchFixture = {
  data: [
    {
      id: 'abc-123',
      attributes: {
        title: { en: 'My Hero Academia' },
        altTitles: [{ ja: '僕のヒーローアカデミア' }, { 'en-us': 'Boku no Hero Academia' }],
        description: { en: '**A hero** story with [link](https://example.com).', fr: 'Une histoire de héros.' },
        status: 'ongoing',
        tags: [
          { attributes: { name: { en: 'Action' } } },
          { attributes: { name: { en: 'School' } } }
        ]
      },
      relationships: [{ type: 'cover_art', id: 'cov-1', attributes: { fileName: 'abc-123.jpg' } }]
    }
  ]
}

const chaptersFixture = {
  data: [
    { id: 'ch-1', attributes: { chapter: '1', volume: '1', title: 'Pilot', publishedAt: '2020-01-01' } },
    { id: 'ch-2', attributes: { chapter: '1', volume: '2', title: 'Vol2 reprint' } },
    { id: 'ch-3', attributes: { chapter: '2', volume: null, title: null } },
    { id: 'ch-4', attributes: { chapter: '42.5', volume: null } },
    { id: 'ch-5', attributes: { chapter: null, volume: null, title: 'Omake' } }
  ],
  total: 5,
  limit: 96,
  offset: 0
}

const serverFixture = {
  baseUrl: 'https://uploads.mangadex.org',
  chapter: { hash: 'HASH', data: ['1.png', '2.png'], dataSaver: ['1-s.png', '2-s.png'] }
}

const emptyServerFixture = {
  baseUrl: 'https://uploads.mangadex.org',
  chapter: { hash: 'HASH', data: [], dataSaver: [] }
}

function fixtureFetch(routes: Record<string, unknown>): FetchFn {
  return async (url) => {
    const entry = Object.entries(routes).find(([key]) => url.includes(key))
    if (!entry) return { status: 404, headers: {}, body: 'not found' }
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry[1]) }
  }
}

const ctx = {
  cache: {
    async withCache<T>(_k: string, _t: number, compute: () => Promise<T>): Promise<T> {
      return compute()
    }
  },
  preferences: {
    async getWithDefault<T>(key: string, fallback: T): Promise<T> {
      return (prefOverrides[key] as T | undefined) ?? fallback
    },
    async get() {
      return undefined
    },
    async set() {}
  }
}

/** test-time overrides consulted by the shared ctx.preferences fixture */
const prefOverrides: Record<string, unknown> = {}

describe('mangadex source', () => {
  it('parses search results', async () => {
    const res = await mangaDexSource.search({ ...ctx, fetch: fixtureFetch({ '/manga?': searchFixture }) }, 'hero', 1)
    expect(res.items).toHaveLength(1)
    const m = res.items[0]!
    expect(m.id).toBe('mangadex/abc-123')
    expect(m.title).toBe('My Hero Academia')
    expect(m.altTitles).toContain('僕のヒーローアカデミア')
    expect(m.coverUrl).toContain('uploads.mangadex.org/covers/abc-123/abc-123.jpg')
    expect(m.synopsis).toBe('**A hero** story with [link](https://example.com).')
    expect(m.tags).toEqual(['Action', 'School'])
    expect(m.status).toBe('ongoing')
  })

  it('falls back to the first description locale when en is absent', async () => {
    const entity = JSON.parse(JSON.stringify(searchFixture.data[0]))
    entity.attributes.description = { fr: 'Une histoire de héros.', ja: 'ヒーロー物語' }
    const m = await mangaDexSource.getMedia({ ...ctx, fetch: fixtureFetch({ '/manga/abc-123': { data: entity } }) }, 'abc-123')
    expect(m.synopsis).toBe('Une histoire de héros.')
  })

  it('leaves synopsis undefined when no description is present', async () => {
    const entity = JSON.parse(JSON.stringify(searchFixture.data[0]))
    delete entity.attributes.description
    const m = await mangaDexSource.getMedia({ ...ctx, fetch: fixtureFetch({ '/manga/abc-123': { data: entity } }) }, 'abc-123')
    expect(m.synopsis).toBeUndefined()
  })

  it('dedupes chapters and maps numbers/seasons', async () => {
    const eps = await mangaDexSource.getEpisodes({ ...ctx, fetch: fixtureFetch({ '/feed?': chaptersFixture }) }, 'abc-123')
    expect(eps.map((e) => e.number)).toEqual([1, 2, 42.5])
    // ch-2 is a duplicate chapter number (different volume) -> dropped
    expect(eps).toHaveLength(3)
    expect(eps[0]?.season).toBe(1)
    expect(eps[2]?.number).toBe(42.5)
  })

  it('uses data-saver URLs when the preference is on (default)', async () => {
    delete prefOverrides.dataSaver
    const content = await mangaDexSource.getChapterContent(
      { ...ctx, fetch: fixtureFetch({ '/at-home': serverFixture }) },
      'abc-123',
      'ch-1'
    )
    expect(content).toEqual({
      type: 'pages',
      images: ['https://uploads.mangadex.org/data-saver/HASH/1-s.png', 'https://uploads.mangadex.org/data-saver/HASH/2-s.png']
    })
  })

  it('uses full-res URLs when data-saver is off', async () => {
    prefOverrides.dataSaver = false
    const content = await mangaDexSource.getChapterContent(
      { ...ctx, fetch: fixtureFetch({ '/at-home': serverFixture }) },
      'abc-123',
      'ch-1'
    )
    expect(content).toEqual({
      type: 'pages',
      images: ['https://uploads.mangadex.org/data/HASH/1.png', 'https://uploads.mangadex.org/data/HASH/2.png']
    })
  })

  it('uses the language preference in the feed request', async () => {
    prefOverrides.lang = ['fr']
    const fetch = fixtureFetch({ '/feed?': chaptersFixture })
    const spy = vi.fn(fetch)
    await mangaDexSource.getEpisodes({ ...ctx, fetch: spy }, 'abc-123')
    const urls = spy.mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => u.includes('translatedLanguage[]=fr'))).toBe(true)
    delete prefOverrides.lang
  })

  it('emits one translatedLanguage param per selected language (deduped)', async () => {
    prefOverrides.lang = ['en', 'pt-br', 'en']
    const fetch = fixtureFetch({ '/feed?': chaptersFixture })
    const spy = vi.fn(fetch)
    await mangaDexSource.getEpisodes({ ...ctx, fetch: spy }, 'abc-123')
    const urls = spy.mock.calls.map(([u]) => String(u))
    const first = urls[0]!
    expect(first).toContain('translatedLanguage[]=en')
    expect(first).toContain('translatedLanguage[]=pt-br')
    // deduped: 'en' appears once, 'pt-br' once
    expect(first.match(/translatedLanguage\[\]=/g)).toHaveLength(2)
    delete prefOverrides.lang
  })

  it('returns a text view for a chapter with no images (novel)', async () => {
    const content = await mangaDexSource.getChapterContent(
      { ...ctx, fetch: fixtureFetch({ '/at-home': emptyServerFixture }) },
      'abc-123',
      'ch-1'
    )
    expect(content.type).toBe('text')
  })

  it('parses getMedia when data is a single entity (not an array)', async () => {
    const entity = { ...searchFixture.data[0]! }
    const m = await mangaDexSource.getMedia({ ...ctx, fetch: fixtureFetch({ '/manga/abc-123': { data: entity } }) }, 'abc-123')
    expect(m.id).toBe('mangadex/abc-123')
    expect(m.title).toBe('My Hero Academia')
    expect(m.coverUrl).toContain('uploads.mangadex.org/covers/abc-123/abc-123.jpg')
  })

  it('throws on HTTP error', async () => {
    const fetch: FetchFn = async () => ({ status: 500, headers: {}, body: 'err' })
    await expect(mangaDexSource.search({ ...ctx, fetch }, 'q', 1)).rejects.toThrow(/HTTP 500/)
  })
})
