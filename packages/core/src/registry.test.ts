import { describe, expect, it } from 'vitest'
import { PluginRegistry, validateManifest } from '../src/registry.js'
import { loadBundle } from '../src/loader.js'
import { MemoryStore } from '../src/store.js'
import { API_VERSION } from '../src/version.js'
import type { PluginRegistration, Source } from '../src/types.js'

const reg: PluginRegistration = {
  manifest: {
    id: 'p1',
    name: 'Plugin 1',
    version: '1.0.0',
    apiVersion: API_VERSION,
    mediaTypes: ['manga'],
    entry: 'p1.plugin.js',
    sourceIds: ['s1']
  },
  sources: [
    {
      id: 's1',
      name: 'Source 1',
      mediaTypes: ['manga'],
      async search() {
        return { page: 1, hasNextPage: false, items: [] }
      },
      async getMedia() {
        throw new Error('ni')
      },
      async getEpisodes() {
        return []
      },
      async getChapterContent() {
        return { type: 'text', html: '' }
      }
    } satisfies Source
  ]
}

describe('PluginRegistry', () => {
  it('rejects wrong apiVersion', () => {
    const registry = new PluginRegistry()
    expect(() =>
      registry.registerBundled({ ...reg, manifest: { ...reg.manifest, apiVersion: API_VERSION + 1 } })
    ).toThrow(/apiVersion/)
  })

  it('lists enabled sources only', () => {
    const registry = new PluginRegistry()
    registry.registerBundled(reg)
    expect(registry.sources()).toHaveLength(1)
    registry.setEnabled('p1', false)
    expect(registry.sources()).toHaveLength(0)
  })

  it('filters sources by per-source toggle and resets on plugin re-enable', () => {
    const multi = {
      ...reg,
      manifest: { ...reg.manifest, id: 'p2', sourceIds: ['s1', 's2'] },
      sources: [
        { ...reg.sources[0]! },
        { ...reg.sources[0]!, id: 's2', name: 'Source 2' }
      ]
    }
    const registry = new PluginRegistry()
    registry.registerBundled(multi)
    expect(registry.sources().map((s) => s.id)).toEqual(['s1', 's2'])
    registry.setSourceEnabled('s1', false)
    expect(registry.sources().map((s) => s.id)).toEqual(['s2'])
    expect(registry.isSourceEnabled('s1')).toBe(false)
    registry.setSourceEnabled('s1', true)
    expect(registry.sources().map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('validates manifests', () => {
    expect(() => validateManifest({ ...reg.manifest, apiVersion: 'x' })).toThrow()
    expect(() => validateManifest({ ...reg.manifest, id: 'Bad ID!' })).toThrow()
    expect(validateManifest(reg.manifest).id).toBe('p1')
  })

  it('accepts a multi-select pref with an array default', () => {
    const manifest = validateManifest({
      ...reg.manifest,
      prefs: [{ key: 'lang', label: 'Language', type: 'multi', defaultValue: ['en', 'pt-br'], options: [{ value: 'en', label: 'English' }] }]
    })
    expect(manifest.prefs?.[0]?.type).toBe('multi')
  })

  it('rejects a multi pref whose default is not an array', () => {
    expect(() =>
      validateManifest({
        ...reg.manifest,
        prefs: [{ key: 'lang', label: 'Language', type: 'multi', defaultValue: 'en' }]
      })
    ).toThrow()
  })
})

describe('loadBundle', () => {
  it('captures a registration from an IIFE', () => {
    const code = `
      (() => {
        globalThis.__media_plugin_register({
          manifest: { id: 'iife', name: 'IIFE', version: '1.0.0', apiVersion: ${API_VERSION}, mediaTypes: ['manga'], entry: 'iife.plugin.js', sourceIds: ['s'] },
          sources: []
        });
      })();
    `
    const loaded = loadBundle(code)
    expect(loaded.manifest.id).toBe('iife')
  })

  it('throws when nothing registers', () => {
    expect(() => loadBundle('(() => {})()')).toThrow('did not register')
  })

  it('cleans up the global register key', () => {
    loadBundle(`(() => globalThis.__media_plugin_register({ manifest: { id: 'i', name: 'I', version: '1', apiVersion: ${API_VERSION}, mediaTypes: ['manga'], entry: 'x', sourceIds: [] }, sources: [] }))()`)
    expect((globalThis as Record<string, unknown>).__media_plugin_register).toBeUndefined()
  })
})

describe('MemoryStore', () => {
  it('round-trips add/list/progress/export', async () => {
    const store = new MemoryStore()
    const media = { id: 's/1', title: 'T', mediaId: '1', sourceId: 's', type: 'manga' as const }
    await store.add(media, 'reading')
    await store.setSeen('s/1', 'e1')
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.status).toBe('reading')
    expect((await store.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e1'])

    const store2 = new MemoryStore()
    await store2.importJson(await store.exportJson())
    expect((await store2.list())[0]?.media.title).toBe('T')
    expect((await store2.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e1'])
  })

  it('unsetSeen removes a single episode and cleans up empty progress', async () => {
    const store = new MemoryStore()
    await store.setSeenMany('s/1', ['e1', 'e2'])
    await store.unsetSeen('s/1', 'e1')
    expect((await store.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e2'])
    await store.unsetSeen('s/1', 'e2')
    expect(await store.getProgress('s/1')).toBeUndefined()
    // unsetting an unseen episode is a no-op
    await store.unsetSeen('s/1', 'nope')
    expect(await store.getProgress('s/1')).toBeUndefined()
  })

  it('history is most-recent-first, deduped on re-open, and removable', async () => {
    const store = new MemoryStore()
    const media = { id: 's/1', title: 'T', mediaId: '1', sourceId: 's', type: 'manga' as const }
    const ep1 = { id: 's/1/e1', mediaId: '1', number: 1 }
    const ep2 = { id: 's/1/e2', mediaId: '1', number: 2 }
    await store.addHistory(media, ep1)
    await new Promise((r) => setTimeout(r, 5))
    await store.addHistory(media, ep2)
    await new Promise((r) => setTimeout(r, 5))
    await store.addHistory(media, ep1) // re-open: dedupes, bumps to top
    const list = await store.listHistory()
    expect(list).toHaveLength(2)
    expect(list[0]?.episode.number).toBe(1)
    expect(list[1]?.episode.number).toBe(2)

    await store.removeHistory('s/1/e2')
    expect((await store.listHistory()).map((h) => h.episode.number)).toEqual([1])
  })

  it('export/import round-trips history', async () => {
    const store = new MemoryStore()
    const media = { id: 's/1', title: 'T', mediaId: '1', sourceId: 's', type: 'manga' as const }
    await store.addHistory(media, { id: 's/1/e1', mediaId: '1', number: 1 })
    const store2 = new MemoryStore()
    await store2.importJson(await store.exportJson())
    expect(await store2.listHistory()).toHaveLength(1)
  })
})
