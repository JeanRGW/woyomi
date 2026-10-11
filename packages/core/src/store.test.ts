import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { IndexedDbStore, MemoryStore } from './store.js'
import type { LibraryStore, Media } from './types.js'

function media(id: string): Media {
  return { id, title: `Title ${id}`, type: 'manga', mediaId: id.split('/')[1] ?? id, sourceId: 's' }
}

function episode(id: string) {
  return { id, number: 1, mediaId: 's/1' }
}

let dbCounter = 0

const implementations: Array<[string, () => LibraryStore]> = [
  ['MemoryStore', () => new MemoryStore()],
  ['IndexedDbStore', () => new IndexedDbStore(`store-test-${(dbCounter += 1)}`)]
]

for (const [name, make] of implementations) {
  describe(name, () => {
    it('adopts newer unread changes without restoring stale seen ids', async () => {
      const store = make()
      const snapshot = (seenEpisodeIds: string[], updatedAt: number) => JSON.stringify({
        progress: [{ mediaId: 's/1', seenEpisodeIds, updatedAt }]
      })
      await store.importJson(snapshot(['e1', 'e2'], 100))
      await store.importJson(snapshot(['e2'], 200))
      expect((await store.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e2'])
      await store.importJson(snapshot(['e1', 'e2'], 100))
      expect((await store.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e2'])
    })
    it('adds, updates and removes library entries with tombstones', async () => {
      const store = make()
      await store.add(media('s/1'), 'reading')
      const created = await store.get('s/1')
      expect(created?.status).toBe('reading')

      await store.updateStatus('s/1', 'completed')
      const updated = await store.get('s/1')
      expect(updated?.status).toBe('completed')
      expect(updated?.addedAt).toBe(created?.addedAt)

      await store.remove('s/1')
      expect(await store.get('s/1')).toBeUndefined()
      const exported = JSON.parse(await store.exportJson()) as { tombstones: { entries: Array<{ id: string }> } }
      expect(exported.tombstones.entries.map((t) => t.id)).toEqual(['s/1'])
    })

    it('tracks seen episodes and tombstones the row when emptied', async () => {
      const store = make()
      await store.setSeenMany('s/1', ['e1', 'e2'])
      expect((await store.getProgress('s/1'))?.seenEpisodeIds.sort()).toEqual(['e1', 'e2'])

      await store.unsetSeen('s/1', 'e1')
      expect((await store.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e2'])

      await store.unsetSeen('s/1', 'e2')
      expect(await store.getProgress('s/1')).toBeUndefined()
    })

    it('records and removes history', async () => {
      const store = make()
      await store.addHistory(media('s/1'), episode('s/1/1'))
      expect(await store.listHistory()).toHaveLength(1)

      await store.removeHistory('s/1/1')
      expect(await store.listHistory()).toHaveLength(0)
    })

    it('round-trips exportJson/importJson', async () => {
      const source = make()
      await source.add(media('s/1'), 'reading')
      await source.setSeenMany('s/1', ['e1'])
      await source.addHistory(media('s/1'), episode('s/1/1'))

      const target = make()
      await target.importJson(await source.exportJson())

      expect((await target.get('s/1'))?.media.title).toBe('Title s/1')
      expect((await target.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e1'])
      expect(await target.listHistory()).toHaveLength(1)
    })

    it('does not let a stale import clobber newer local rows', async () => {
      const store = make()
      await store.add(media('s/1'), 'completed')
      const local = await store.get('s/1')

      const stale = JSON.stringify({
        version: 1,
        entries: [{ media: media('s/1'), status: 'dropped', addedAt: 1, updatedAt: (local?.updatedAt ?? 0) - 5000 }],
        progress: [],
        history: [],
        tombstones: { entries: [], progress: [], history: [] }
      })
      await store.importJson(stale)

      expect((await store.get('s/1'))?.status).toBe('completed')
    })

    it('serializes concurrent writes without losing rows or tombstones', async () => {
      const store = make()
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => store.add(media(`s/${i}`), 'reading'))
      )
      expect(await store.list()).toHaveLength(10)

      await Promise.all(Array.from({ length: 5 }, (_, i) => store.remove(`s/${i}`)))
      expect(await store.list()).toHaveLength(5)
      const exported = JSON.parse(await store.exportJson()) as { tombstones: { entries: unknown[] } }
      expect(exported.tombstones.entries).toHaveLength(5)
    })
  })
}
