import { afterEach, describe, expect, it, vi } from 'vitest'
import { pullSync, pushSync, syncConfigured, type SyncConfig } from './sync'
import type { LibraryStore } from '@woyomi/core'

const config: SyncConfig = { server: 'https://sync.test/', user: 'alice/one', token: 'secret' }

function store(exported = JSON.stringify({ version: 1, entries: [], progress: [], history: [] })): LibraryStore {
  return {
    add: vi.fn(),
    updateStatus: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    setSeen: vi.fn(),
    setSeenMany: vi.fn(),
    unsetSeen: vi.fn(),
    unsetSeenMany: vi.fn(),
    getProgress: vi.fn(),
    addHistory: vi.fn(),
    listHistory: vi.fn(),
    removeHistory: vi.fn(),
    exportJson: vi.fn(async () => exported),
    importJson: vi.fn(async () => undefined)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('syncConfigured', () => {
  it('requires server and user', () => {
    expect(syncConfigured({ server: '', user: 'alice', token: '' })).toBe(false)
    expect(syncConfigured({ server: 'https://sync.test', user: ' ', token: '' })).toBe(false)
    expect(syncConfigured(config)).toBe(true)
  })
})

describe('pushSync', () => {
  it('PUTs the exported library with auth and encoded user', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const local = store(JSON.stringify({ version: 1, entries: [{ id: 'entry' }], progress: [], history: [{ id: 'history' }] }))

    await pushSync(local, config)

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://sync.test/api/sync/alice%2Fone')
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(String(init.body))).toEqual({
      version: 1,
      entries: [{ id: 'entry' }],
      progress: [],
      history: [{ id: 'history' }]
    })
  })
})

describe('pullSync', () => {
  it('imports the server response with auth', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ entries: [], progress: [], history: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const local = store()

    await pullSync(local, config)

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://sync.test/api/sync/alice%2Fone')
    expect(init.method).toBeUndefined()
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(local.importJson).toHaveBeenCalledWith(JSON.stringify({ entries: [], progress: [], history: [] }))
  })

  it('reports HTTP failures', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }))
    await expect(pullSync(store(), config)).rejects.toThrow('sync pull -> HTTP 401')
  })
})
