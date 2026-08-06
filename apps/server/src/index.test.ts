import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server, isPrivateTarget } from './index'

const TOKEN = 'changeme'

describe('sync api', () => {
  it('requires auth', async () => {
    const res = await server.request('/api/sync/bob')
    expect(res.status).toBe(401)
  })

  it('round-trips library json with auth', async () => {
    const put = await server.request('/api/sync/bob', {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [{ media: { id: 's/1', title: 'T', mediaId: '1', sourceId: 's', type: 'manga' }, status: 'reading', addedAt: 1 }], progress: [] })
    })
    expect(put.status).toBe(200)

    const get = await server.request('/api/sync/bob', { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(get.status).toBe(200)
    const data = (await get.json()) as { entries: Array<{ media: { title: string } }> }
    expect(data.entries[0]?.media.title).toBe('T')
  })
})

describe('scrape proxy guardrails', () => {
  const originalFetch = globalThis.fetch
  const originalScrapeEnabled = process.env.SCRAPE_ENABLED
  const originalScrapeToken = process.env.SCRAPE_TOKEN

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response('Example Domain', { status: 200 }))
    process.env.SCRAPE_ENABLED = 'true'
    delete process.env.SCRAPE_TOKEN
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.SCRAPE_ENABLED = originalScrapeEnabled
    if (originalScrapeToken === undefined) delete process.env.SCRAPE_TOKEN
    else process.env.SCRAPE_TOKEN = originalScrapeToken
    vi.restoreAllMocks()
  })

  it('proxies an http(s) target when enabled and returns the body', async () => {
    const res = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' })
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { status: number; body: string }
    expect(data.status).toBe(200)
    expect(data.body).toContain('Example Domain')
  })

  it('requires the token when SCRAPE_TOKEN is set', async () => {
    process.env.SCRAPE_TOKEN = 'secret'
    const noAuth = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' })
    })
    expect(noAuth.status).toBe(401)

    const ok = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ url: 'https://example.com/' })
    })
    expect(ok.status).toBe(200)
  })

  it('rejects a response larger than the size cap', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x'.repeat(6 * 1024 * 1024), { status: 200 }))
    const res = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' })
    })
    expect(res.status).toBe(413)
  })

  it('rejects loopback and private targets before fetching', () => {
    expect(isPrivateTarget(new URL('http://localhost:8787/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://127.0.0.1/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://10.0.0.5/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://192.168.1.1/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://172.16.0.1/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://[::1]/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://169.254.169.254/x'))).toBe(true)
    expect(isPrivateTarget(new URL('https://example.com/'))).toBe(false)
  })

  it('blocks IPv4-mapped and NAT64 targets that embed a private IPv4', () => {
    expect(isPrivateTarget(new URL('http://[::ffff:127.0.0.1]/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://[::ffff:192.168.1.1]/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://[64:ff9b::7f00:1]/x'))).toBe(true)
    expect(isPrivateTarget(new URL('http://[64:ff9b::c0a8:101]/x'))).toBe(true)
    // mapped PUBLIC addresses are conservatively blocked too (safe direction)
    expect(isPrivateTarget(new URL('http://[::ffff:8.8.8.8]/x'))).toBe(true)
  })

  it('rejects non-http(s) targets', async () => {
    const res = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'ftp://example.com/x' })
    })
    expect(res.status).toBe(400)
  })

  it('rejects a private target through the endpoint', async () => {
    const res = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:8787/health' })
    })
    expect(res.status).toBe(400)
  })

  it('returns 403 when disabled', async () => {
    process.env.SCRAPE_ENABLED = 'false'
    const res = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/' })
    })
    expect(res.status).toBe(403)
  })

  it('passes through an upstream non-2xx status as {status}', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 }))
    const res = await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/missing' })
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { status: number; body: string }
    expect(data.status).toBe(404)
    expect(data.body).toBe('not found')
  })

  it('strips content-length/host/authorization from forwarded headers', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    globalThis.fetch = fetchMock
    await server.request('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/',
        headers: { 'content-length': '999', host: 'evil.test', authorization: 'Bearer evil', 'x-plugin': '1' }
      })
    })
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    const sent = (init.headers ?? {}) as Record<string, string>
    expect(sent['content-length']).toBeUndefined()
    expect(sent.host).toBeUndefined()
    expect(sent.authorization).toBeUndefined()
    expect(sent['x-plugin']).toBe('1')
  })
})
