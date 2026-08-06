import { describe, expect, it } from 'vitest'
import {
  loadPluginSandbox,
  runPluginWorkerHost,
  type SandboxCtx,
  type SandboxTransport
} from '../src/index.js'
import { API_VERSION } from '../src/version.js'

/** A real-browser-free Worker stand-in: the host runs in-process over a message bus. */
function makeFakeTransport(): SandboxTransport & { crash(): void } {
  let toMain: ((m: unknown) => void) | undefined
  let toHost: ((m: unknown) => void) | undefined
  let errorCb: ((e: unknown) => void) | undefined
  runPluginWorkerHost({
    post: (m) => toMain?.(m),
    onMessage: (h) => {
      toHost = h as (m: unknown) => void
    }
  })
  return {
    post: (m) => toHost?.(m),
    onMessage: (cb) => {
      toMain = cb
    },
    onError: (cb) => {
      errorCb = cb
    },
    terminate: () => {},
    crash: () => errorCb?.(new Error('simulated worker crash'))
  }
}

const TEST_PLUGIN = `
globalThis.__media_plugin_register({
  manifest: { id: 'test', name: 'Test', version: '1.0.0', apiVersion: ${API_VERSION}, mediaTypes: ['manga'], entry: 'test.plugin.js', sourceIds: ['test'] },
  sources: [{
    id: 'test', name: 'Test', mediaTypes: ['manga'],
    async search(ctx, query, page) {
      const res = await ctx.fetch('http://x/' + query + '/' + page)
      return { page, hasNextPage: false, items: JSON.parse(res.body) }
    },
    async getMedia(ctx, mediaId) {
      const label = await ctx.preferences.getWithDefault('label', 'd')
      if (label === 'boom') throw new Error('boom-from-plugin')
      return { id: 'test/' + mediaId, title: label, mediaId, sourceId: 'test', type: 'manga' }
    },
    async getEpisodes(ctx, mediaId) {
      return ctx.cache.withCache('eps:' + mediaId, 60000, async () => {
        const n = (globalThis.__testComputeCalls || 0) + 1
        globalThis.__testComputeCalls = n
        return [{ id: 'test/' + mediaId + '/1', mediaId, number: 1 }]
      })
    },
    async getChapterContent() { return { type: 'text', html: '<p>x</p>' } },
    async getHomeSections() { return [{ id: 'latest', title: 'Latest' }] }
  }]
})
`

function makeCtx(overrides: Partial<SandboxCtx> = {}): SandboxCtx & {
  fetched: Array<[string, string]>
  prefsCalls: Array<[string, string]>
} {
  const cacheMap = new Map<string, unknown>()
  const fetched: Array<[string, string]> = []
  const prefsCalls: Array<[string, string]> = []
  return {
    fetch: async (sourceId, url) => {
      fetched.push([sourceId, url])
      return { status: 200, headers: {}, body: JSON.stringify([{ id: 'test/1', title: 'T', mediaId: '1', sourceId: 'test', type: 'manga' }]) }
    },
    cache: {
      get: async <T>(k: string) => cacheMap.get(k) as T | undefined,
      set: async (k, v) => {
        cacheMap.set(k, v)
      }
    },
    prefs: {
      async get(pluginId, key) {
        prefsCalls.push([pluginId, key])
        return undefined
      },
      async getWithDefault(pluginId, key, fallback) {
        prefsCalls.push([pluginId, key])
        return fallback
      },
      async set() {}
    },
    fetched,
    prefsCalls,
    ...overrides
  }
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error('condition not met in time')
}

async function loadSandbox(transports: Array<SandboxTransport & { crash(): void }> = []) {
  const ctx = makeCtx()
  const sandbox = await loadPluginSandbox({
    code: TEST_PLUGIN,
    ctx,
    createTransport: () => {
      const t = makeFakeTransport()
      transports.push(t)
      return t
    }
  })
  return { sandbox, ctx }
}

describe('plugin sandbox', () => {
  it('loads the bundle and builds proxy sources with the declared methods', async () => {
    const { sandbox } = await loadSandbox()
    expect(sandbox.manifest.id).toBe('test')
    const source = sandbox.sources[0]!
    expect(source.id).toBe('test')
    expect(typeof source.search).toBe('function')
    expect(typeof source.getHomeSections).toBe('function')
    expect(source.getStreams).toBeUndefined()
    expect(source.getHomeSection).toBeUndefined()
  })

  it('routes ctx.fetch to the main thread with the source id', async () => {
    const { sandbox, ctx } = await loadSandbox()
    const r = await sandbox.sources[0]!.search(null as never, 'q', 1)
    expect(r.items[0]?.title).toBe('T')
    expect(ctx.fetched).toEqual([['test', 'http://x/q/1']])
  })

  it('serves ctx.cache.withCache with one compute per key', async () => {
    const { sandbox } = await loadSandbox()
    const src = sandbox.sources[0]!
    const a = await src.getEpisodes(null as never, 'm1')
    const b = await src.getEpisodes(null as never, 'm1')
    expect(a).toEqual(b)
    expect((globalThis as unknown as Record<string, number>).__testComputeCalls).toBe(1)
  })

  it('binds preferences to the plugin id', async () => {
    const { sandbox, ctx } = await loadSandbox()
    const m = await sandbox.sources[0]!.getMedia(null as never, '7')
    expect(m.title).toBe('d')
    expect(ctx.prefsCalls).toEqual([['test', 'label']])
  })

  it('propagates plugin errors across the boundary', async () => {
    const ctx = makeCtx({
      prefs: {
        async get() {
          return undefined
        },
        async getWithDefault() {
          return 'boom' as never
        },
        async set() {}
      }
    })
    const sandbox = await loadPluginSandbox({
      code: TEST_PLUGIN,
      ctx,
      createTransport: makeFakeTransport
    })
    await expect(sandbox.sources[0]!.getMedia(null as never, '7')).rejects.toThrow('boom-from-plugin')
  })

  it('rejects calls after terminate (no relaunch)', async () => {
    const { sandbox } = await loadSandbox()
    sandbox.terminate()
    await expect(sandbox.invoke('test', 'search', ['q', 1])).rejects.toThrow('disposed')
  })

  it('relaunches a crashed worker lazily on the next call', async () => {
    const transports: Array<SandboxTransport & { crash(): void }> = []
    const { sandbox, ctx } = await loadSandbox(transports)
    await sandbox.sources[0]!.search(null as never, 'q', 1)
    expect(transports).toHaveLength(1)
    transports[0]!.crash()
    const r = await sandbox.sources[0]!.search(null as never, 'q', 1)
    expect(r.items[0]?.title).toBe('T')
    expect(transports).toHaveLength(2)
    expect(ctx.fetched).toHaveLength(2)
  })

  it('does not misdeliver a stale ctx reply to the relaunched worker', async () => {
    const gate: Array<() => void> = []
    const fetch = async (_sourceId: string, url: string) => {
      await new Promise<void>((r) => gate.push(r))
      const title = url.includes('slow') ? 'STALE' : 'FRESH'
      return { status: 200, headers: {}, body: JSON.stringify([{ id: 'test/x', title, mediaId: '1', sourceId: 'test', type: 'manga' }]) }
    }
    const ctx = makeCtx({ fetch })
    const transports: Array<SandboxTransport & { crash(): void }> = []
    const sandbox = await loadPluginSandbox({
      code: TEST_PLUGIN,
      ctx,
      createTransport: () => {
        const t = makeFakeTransport()
        transports.push(t)
        return t
      }
    })
    const src = sandbox.sources[0]!

    const slow = src.search(null as never, 'slow', 1)
    await until(() => gate.length >= 1)
    transports[0]!.crash()
    await expect(slow).rejects.toThrow()

    const fresh = src.search(null as never, 'fast', 1)
    await until(() => gate.length >= 2)
    gate[0]!() // stale fetch resolves; must not reach the new worker's cid 1
    await new Promise((r) => setTimeout(r, 0))
    gate[1]!() // fresh fetch resolves
    expect((await fresh).items[0]?.title).toBe('FRESH')
  })

  it('runs concurrent invocations on one plugin in parallel', async () => {
    const gate: Array<() => void> = []
    const fetch = async () => {
      await new Promise<void>((r) => gate.push(r))
      return { status: 200, headers: {}, body: JSON.stringify([]) }
    }
    const sandbox = await loadPluginSandbox({
      code: TEST_PLUGIN,
      ctx: makeCtx({ fetch }),
      createTransport: makeFakeTransport
    })
    const src = sandbox.sources[0]!
    const a = src.search(null as never, 'a', 1)
    const b = src.search(null as never, 'b', 1)
    await until(() => gate.length >= 2)
    expect(gate.length).toBe(2)
    gate.forEach((r) => r())
    await Promise.all([a, b])
  })

  it('fails the load handshake when the bundle cannot be evaluated', async () => {
    await expect(
      loadPluginSandbox({
        code: 'throw new Error("syntax boom")',
        ctx: makeCtx(),
        createTransport: makeFakeTransport
      })
    ).rejects.toThrow()
  })
})
