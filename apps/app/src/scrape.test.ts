import { afterEach, describe, expect, it, vi } from 'vitest'
import { annotateFetchError, isNetworkError, proxyUrl, scrapeRequest, shouldProxy } from './scrape'
import type { ScrapeConfig } from './scrape'

afterEach(() => vi.unstubAllGlobals())

describe('proxyUrl', () => {
  it('normalizes a trailing slash and appends /api/scrape', () => {
    expect(proxyUrl('http://localhost:8787')).toBe('http://localhost:8787/api/scrape')
    expect(proxyUrl('http://localhost:8787/')).toBe('http://localhost:8787/api/scrape')
    expect(proxyUrl('https://host.example/')).toBe('https://host.example/api/scrape')
  })
})

describe('scrapeRequest', () => {
  const config: ScrapeConfig = { url: 'http://proxy.test', token: '' }

  it('POSTs the target to the proxy and maps the response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 200, headers: { 'x-a': 'b' }, body: 'hello' }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await scrapeRequest(config, 'https://example.com/manga', { method: 'GET', headers: { 'x-h': '1' } })
    expect(res).toEqual({ status: 200, headers: { 'x-a': 'b' }, body: 'hello' })

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('http://proxy.test/api/scrape')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://example.com/manga',
      method: 'GET',
      headers: { 'x-h': '1' },
      body: undefined
    })
  })

  it('sends the bearer token when configured', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 200 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await scrapeRequest({ url: 'http://proxy.test', token: 'secret' }, 'https://example.com/')
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
  })

  it('throws the server error message on a non-2xx proxy response', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'private targets are not allowed' }), { status: 400 }))
    await expect(scrapeRequest(config, 'https://example.com/')).rejects.toThrow('private targets are not allowed')
  })
})

describe('shouldProxy', () => {
  it('routes cross-origin targets through the proxy', () => {
    const cfg: ScrapeConfig = { url: 'http://proxy.test', token: '' }
    expect(shouldProxy(cfg, 'https://example.com/manga')).toBe(true)
  })
  it('bypasses the proxy for its own origin (repo served by the same server)', () => {
    const cfg: ScrapeConfig = { url: 'http://localhost:8787', token: '' }
    expect(shouldProxy(cfg, 'http://localhost:8787/repo/index.json')).toBe(false)
    expect(shouldProxy(cfg, 'http://localhost:8787/repo/mangadex.plugin.js')).toBe(false)
  })
  it('returns false when no proxy is configured', () => {
    expect(shouldProxy({ url: '', token: '' }, 'https://example.com/')).toBe(false)
  })
})

describe('isNetworkError / annotation policy', () => {
  it('network TypeErrors ARE annotated as proxy-unreachable', () => {
    const cfg: ScrapeConfig = { url: 'http://proxy.test', token: '' }
    const wrapped = annotateFetchError(cfg, new TypeError('Failed to fetch'))
    expect(wrapped.message).toContain('proxy.test')
    expect(wrapped.message).toContain('unreachable')
  })
  it('server 4xx errors are NOT network errors and not annotated', () => {
    // scrapeRequest throws a plain Error with the server message on non-2xx
    expect(isNetworkError(new Error('private targets are not allowed'))).toBe(false)
    expect(isNetworkError(new Error('upstream response too large'))).toBe(false)
  })
})

describe('annotateFetchError', () => {
  it('hints at Settings when no proxy is configured', () => {
    const err = annotateFetchError({ url: '', token: '' }, new Error('Failed to fetch'))
    expect(err.message).toContain('Settings > Web proxy')
  })
  it('points at the proxy URL when one is configured', () => {
    const err = annotateFetchError({ url: 'http://proxy.test', token: '' }, new Error('Failed to fetch'))
    expect(err.message).toContain('http://proxy.test')
  })
  it('wraps non-Error values', () => {
    const err = annotateFetchError({ url: '', token: '' }, 'boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('boom')
  })
})