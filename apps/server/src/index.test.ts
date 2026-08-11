import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { server, isPrivateTarget, mergeLibraries } from './index'
import type { LibraryEntry, SyncPayload } from '@woyomi/core'

const TOKEN = 'changeme'

const originalDataDir = process.env.DATA_DIR

beforeEach(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'woyomi-server-test-'))
})
afterEach(() => {
  if (process.env.DATA_DIR) rmSync(process.env.DATA_DIR, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = originalDataDir
})

function entry(id: string, status = 'reading', updatedAt = 10): LibraryEntry {
  return {
    media: { id, title: id, mediaId: id, sourceId: 's', type: 'manga' },
    status: status as LibraryEntry['status'],
    addedAt: updatedAt,
    updatedAt
  }
}

function payload(overrides: Partial<SyncPayload> = {}): SyncPayload {
  return { version: 1, entries: [], progress: [], history: [], tombstones: { entries: [], progress: [], history: [] }, ...overrides }
}

describe('sync api', () => {
  it('requires auth', async () => {
    const res = await server.request('/api/sync/bob')
    expect(res.status).toBe(401)
  })

  it('round-trips library json with auth', async () => {
    const put = await server.request(`/api/sync/bob`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        payload({
          entries: [entry('s/1', 'reading', 1)],
          history: [{ media: { id: 's/1', mediaId: '1', sourceId: 's', title: 'T', type: 'manga' }, episode: { id: 'e/1', number: 1, mediaId: '1' }, openedAt: 2 }]
        })
      )
    })
    expect(put.status).toBe(200)

    const get = await server.request(`/api/sync/bob`, { headers: { authorization: `Bearer ${TOKEN}` } })
    const data = (await get.json()) as { entries: Array<{ media: { title: string } }>; history: Array<{ openedAt: number }> }
    expect(data.entries[0]?.media.title).toBe('s/1')
    expect(data.history[0]?.openedAt).toBe(2)
  })

  it('returns the merged payload from PUT', async () => {
    const res = await server.request(`/api/sync/carol`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload({ entries: [entry('s/1', 'reading', 5)] }))
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as SyncPayload
    expect(data.entries.map((e) => e.media.id)).toEqual(['s/1'])
    expect(data.tombstones.entries).toEqual([])
  })
})

describe('mergeLibraries', () => {
  it('unions seenEpisodeIds across devices', () => {
    const prev = payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e1'], updatedAt: 1 }] })
    const inc = payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e2'], updatedAt: 2 }] })
    const merged = mergeLibraries(prev, inc)
    expect(merged.progress).toEqual([{ mediaId: 's/1', seenEpisodeIds: ['e1', 'e2'], updatedAt: 2 }])
  })

  it('keeps the entry with the newer updatedAt', () => {
    const prev = payload({ entries: [entry('s/1', 'reading', 5)] })
    const inc = payload({ entries: [entry('s/1', 'completed', 10)] })
    const merged = mergeLibraries(prev, inc)
    expect(merged.entries[0]?.status).toBe('completed')
  })

  it('a newer tombstone beats an older live entry', () => {
    const prev = payload({ entries: [entry('s/1', 'reading', 5)] })
    const inc = payload({ tombstones: { entries: [{ id: 's/1', deletedAt: 10 }] } })
    const merged = mergeLibraries(prev, inc)
    expect(merged.entries).toEqual([])
    expect(merged.tombstones.entries).toEqual([{ id: 's/1', deletedAt: 10 }])
  })

  it('a newer re-add beats an older tombstone', () => {
    const prev = payload({ tombstones: { entries: [{ id: 's/1', deletedAt: 5 }] } })
    const inc = payload({ entries: [entry('s/1', 'reading', 10)] })
    const merged = mergeLibraries(prev, inc)
    expect(merged.entries.map((e) => e.media.id)).toEqual(['s/1'])
    expect(merged.tombstones.entries).toEqual([])
  })

  it('keeps history by max openedAt', () => {
    const prev = payload({ history: [{ media: { id: 's/1', mediaId: '1', sourceId: 's', title: 'T', type: 'manga' }, episode: { id: 'e/1', number: 1, mediaId: '1' }, openedAt: 5 }] })
    const inc = payload({ history: [{ media: { id: 's/1', mediaId: '1', sourceId: 's', title: 'T', type: 'manga' }, episode: { id: 'e/1', number: 1, mediaId: '1' }, openedAt: 10 }] })
    const merged = mergeLibraries(prev, inc)
    expect(merged.history[0]?.openedAt).toBe(10)
  })

  it('a history tombstone removes the row when newer than openedAt', () => {
    const prev = payload({ history: [{ media: { id: 's/1', mediaId: '1', sourceId: 's', title: 'T', type: 'manga' }, episode: { id: 'e/1', number: 1, mediaId: '1' }, openedAt: 5 }] })
    const inc = payload({ tombstones: { history: [{ id: 'e/1', deletedAt: 10 }] } })
    const merged = mergeLibraries(prev, inc)
    expect(merged.history).toEqual([])
  })

  it('keeps the entry from an empty stored state', () => {
    const merged = mergeLibraries(payload(), payload({ entries: [entry('s/1')] }))
    expect(merged.entries).toHaveLength(1)
  })

  it('a progress tombstone removes the row when newer than updatedAt', () => {
    const prev = payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e1'], updatedAt: 5 }] })
    const inc = payload({ tombstones: { progress: [{ id: 's/1', deletedAt: 10 }] } })
    const merged = mergeLibraries(prev, inc)
    expect(merged.progress).toEqual([])
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

describe('stream proxy (/api/stream)', () => {
  const originalFetch = globalThis.fetch
  const originalScrapeEnabled = process.env.SCRAPE_ENABLED
  const originalScrapeToken = process.env.SCRAPE_TOKEN

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers)
      if (h.get('range') === 'bytes=0-0' && h.get('referer') === 'https://site/') {
        return new Response('x', { status: 206, headers: { 'content-range': 'bytes 0-0/5' } })
      }
      return new Response('body', { status: 200, headers: { 'content-type': 'video/mp4' } })
    })
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

  it('returns 403 when scrape proxy is disabled', async () => {
    process.env.SCRAPE_ENABLED = 'false'
    const res = await server.request('/api/stream?url=https://v.example/e.m4v')
    expect(res.status).toBe(403)
  })

  it('returns 401 when a token is set but not supplied', async () => {
    process.env.SCRAPE_TOKEN = 'secret'
    const res = await server.request('/api/stream?url=https://v.example/e.m4v')
    expect(res.status).toBe(401)
  })

  it('requires the url param', async () => {
    const res = await server.request('/api/stream')
    expect(res.status).toBe(400)
  })

  it('rejects non-http targets', async () => {
    const res = await server.request('/api/stream?url=file:///etc/passwd')
    expect(res.status).toBe(400)
  })

  it('rejects private targets (SSRF)', async () => {
    const res = await server.request('/api/stream?url=http://127.0.0.1/x')
    expect(res.status).toBe(400)
  })

  it('rejects bad headers JSON', async () => {
    const res = await server.request('/api/stream?url=https://v.example/e.m4v&headers=%%bad')
    expect(res.status).toBe(400)
  })

  it('streams the upstream body with forwarded headers and Range', async () => {
    const headers = encodeURIComponent(JSON.stringify({ Referer: 'https://site/' }))
    const res = await server.request(
      `/api/stream?url=https://v.example/e.m4v&headers=${headers}`,
      { headers: { range: 'bytes=0-0' } }
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-0/5')
    expect(await res.text()).toBe('x')

    const [url, init] = (globalThis.fetch as Mock).mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://v.example/e.m4v')
    const sent = new Headers(init.headers)
    expect(sent.get('referer')).toBe('https://site/')
    expect(sent.get('range')).toBe('bytes=0-0')
    expect(sent.get('authorization')).toBeNull()
    expect(sent.get('content-length')).toBeNull()
  })

  it('passes the token via query', async () => {
    process.env.SCRAPE_TOKEN = 'secret'
    const res = await server.request('/api/stream?url=https://v.example/e.m4v&token=secret')
    expect(res.status).toBe(200)
    const res2 = await server.request('/api/stream?url=https://v.example/e.m4v&token=nope')
    expect(res2.status).toBe(401)
  })

  it('strips hop-by-hop response headers', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce(new Response('x', { headers: { 'transfer-encoding': 'chunked' } }))
    const res = await server.request('/api/stream?url=https://v.example/e.m4v')
    expect(res.headers.get('transfer-encoding')).toBeNull()
  })
})
