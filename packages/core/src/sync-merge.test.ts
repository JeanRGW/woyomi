import { describe, expect, it } from 'vitest'
import { mergeSyncPayload, parseSyncPayload } from './sync-merge.js'
import { MemoryStore } from './store.js'
import type { Episode, Media, SyncPayload } from './types.js'

function media(id: string): Media {
  return { id, title: `Title ${id}`, type: 'manga', mediaId: id.split('/')[1] ?? id, sourceId: 's' }
}

function episode(id: string): Episode {
  return { id, number: 1, mediaId: 's/1' }
}

function entry(id: string, updatedAt: number): SyncPayload['entries'][number] {
  return { media: media(id), status: 'reading', addedAt: updatedAt - 1000, updatedAt }
}

function payload(over: Partial<SyncPayload> = {}): SyncPayload {
  return { version: 1, entries: [], progress: [], history: [], tombstones: { entries: [], progress: [], history: [] }, ...over }
}

describe('parseSyncPayload', () => {
  it('rejects malformed JSON', () => {
    expect(() => parseSyncPayload('{nope')).toThrow('invalid sync payload: malformed JSON')
  })

  it('rejects rows with the wrong shape and names the field', () => {
    expect(() => parseSyncPayload(JSON.stringify({ entries: [{ media: { id: 1 }, status: 'reading', addedAt: 1 }] }))).toThrow(
      /invalid sync payload: entries\.0/
    )
  })

  it('defaults missing collections and version', () => {
    const parsed = parseSyncPayload('{}')
    expect(parsed).toEqual({ version: 1, entries: [], progress: [], history: [], tombstones: { entries: [], progress: [], history: [] } })
  })
})

describe('mergeSyncPayload', () => {
  it('keeps the newer entry on conflict', () => {
    const merged = mergeSyncPayload(payload({ entries: [entry('s/1', 10)] }), payload({ entries: [entry('s/1', 20)] }))
    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]?.updatedAt).toBe(20)
  })

  it('keeps local-only rows when the incoming payload is stale/partial', () => {
    const merged = mergeSyncPayload(payload({ entries: [entry('s/1', 10)] }), payload())
    expect(merged.entries.map((e) => e.media.id)).toEqual(['s/1'])
  })

  it('lets a newer tombstone delete a live row', () => {
    const merged = mergeSyncPayload(
      payload({ entries: [entry('s/1', 10)] }),
      payload({ tombstones: { entries: [{ id: 's/1', deletedAt: 20 }], progress: [], history: [] } })
    )
    expect(merged.entries).toEqual([])
    expect(merged.tombstones.entries).toEqual([{ id: 's/1', deletedAt: 20 }])
  })

  it('lets a newer live row resurrect over an older tombstone', () => {
    const merged = mergeSyncPayload(
      payload({ tombstones: { entries: [{ id: 's/1', deletedAt: 10 }], progress: [], history: [] } }),
      payload({ entries: [entry('s/1', 20)] })
    )
    expect(merged.entries.map((e) => e.media.id)).toEqual(['s/1'])
    expect(merged.tombstones.entries).toEqual([])
  })

  it('falls back to addedAt for legacy entries without updatedAt', () => {
    const legacy = { media: media('s/1'), status: 'reading' as const, addedAt: 30 }
    const merged = mergeSyncPayload(
      payload({ entries: [legacy] }),
      payload({ tombstones: { entries: [{ id: 's/1', deletedAt: 20 }], progress: [], history: [] } })
    )
    expect(merged.entries.map((e) => e.media.id)).toEqual(['s/1'])
  })

  it('keeps the newest progress snapshot in either merge order', () => {
    const merged = mergeSyncPayload(
      payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e1'], updatedAt: 10 }] }),
      payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e2'], updatedAt: 20 }] })
    )
    expect(merged.progress[0]?.seenEpisodeIds).toEqual(['e2'])
    expect(merged.progress[0]?.updatedAt).toBe(20)
    const reversed = mergeSyncPayload(
      payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e2'], updatedAt: 20 }] }),
      payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e1'], updatedAt: 10 }] })
    )
    expect(reversed.progress).toEqual(merged.progress)
  })

  it('applies progress tombstones only when newer than the row', () => {
    const merged = mergeSyncPayload(
      payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e1'], updatedAt: 30 }] }),
      payload({ tombstones: { entries: [], progress: [{ id: 's/1', deletedAt: 20 }], history: [] } })
    )
    expect(merged.progress).toHaveLength(1)

    const merged2 = mergeSyncPayload(
      payload({ progress: [{ mediaId: 's/1', seenEpisodeIds: ['e1'], updatedAt: 10 }] }),
      payload({ tombstones: { entries: [], progress: [{ id: 's/1', deletedAt: 20 }], history: [] } })
    )
    expect(merged2.progress).toEqual([])
    expect(merged2.tombstones.progress).toEqual([{ id: 's/1', deletedAt: 20 }])
  })

  it('keeps the newest history row and merges tombstones by max deletedAt', () => {
    const h1 = { media: media('s/1'), episode: episode('s/1/1'), openedAt: 10 }
    const h2 = { media: media('s/1'), episode: episode('s/1/1'), openedAt: 20 }
    const merged = mergeSyncPayload(
      payload({ history: [h2], tombstones: { entries: [], progress: [], history: [{ id: 's/1/1', deletedAt: 30 }] } }),
      payload({ history: [h1], tombstones: { entries: [], progress: [], history: [{ id: 's/1/1', deletedAt: 15 }] } })
    )
    expect(merged.history).toEqual([])
    expect(merged.tombstones.history).toEqual([{ id: 's/1/1', deletedAt: 30 }])
  })
})

describe('MemoryStore.importJson', () => {
  it('does not let a stale payload clobber newer local rows', async () => {
    const store = new MemoryStore()
    await store.add(media('s/1'), 'reading')
    const local = await store.get('s/1')
    const stale = JSON.stringify(payload({ entries: [{ ...entry('s/1', (local?.updatedAt ?? 0) - 5000), status: 'dropped' }] }))

    await store.importJson(stale)

    expect((await store.get('s/1'))?.status).toBe('reading')
  })

  it('adopts newer incoming rows', async () => {
    const store = new MemoryStore()
    await store.add(media('s/1'), 'reading')
    const newer = JSON.stringify(payload({ entries: [{ ...entry('s/1', Date.now() + 5000), status: 'completed' }] }))

    await store.importJson(newer)

    expect((await store.get('s/1'))?.status).toBe('completed')
  })

  it('keeps local tombstones the incoming payload does not know about', async () => {
    const store = new MemoryStore()
    await store.add(media('s/1'), 'reading')
    await store.remove('s/1')

    await store.importJson(JSON.stringify(payload()))

    expect(await store.get('s/1')).toBeUndefined()
    const exported = parseSyncPayload(await store.exportJson())
    expect(exported.tombstones.entries.map((t) => t.id)).toEqual(['s/1'])
  })

  it('rejects invalid payloads without touching local state', async () => {
    const store = new MemoryStore()
    await store.add(media('s/1'), 'reading')

    await expect(store.importJson('{"entries": [{"nope": true}]}')).rejects.toThrow('invalid sync payload')
    expect(await store.list()).toHaveLength(1)
  })
})
