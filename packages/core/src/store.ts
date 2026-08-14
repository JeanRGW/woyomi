import type {
  CachedMediaPage,
  Episode,
  HistoryEntry,
  LibraryEntry,
  LibraryStatus,
  LibraryStore,
  Media,
  MediaPageCache,
  PluginStoredBundle,
  PluginStore,
  PreferencesApi,
  PreferenceValue,
  ProgressEntry,
  SyncEdits,
  SyncPayload
} from './types.js'

/** In-memory store used for tests and non-persistent scenarios. */
export class MemoryStore implements LibraryStore {
  private entries = new Map<string, LibraryEntry>()
  private progress = new Map<string, ProgressEntry>()
  private history = new Map<string, HistoryEntry>()
  private tombEntries = new Map<string, number>()
  private tombProgress = new Map<string, number>()
  private tombHistory = new Map<string, number>()

  async add(media: Media, status: LibraryStatus): Promise<void> {
    const prev = this.entries.get(media.id)
    this.entries.set(media.id, { media, status, addedAt: prev?.addedAt ?? Date.now(), updatedAt: Date.now() })
    this.tombEntries.delete(media.id)
  }

  async updateStatus(mediaId: string, status: LibraryStatus): Promise<void> {
    const entry = this.entries.get(mediaId)
    if (entry) this.entries.set(mediaId, { ...entry, status, updatedAt: Date.now() })
  }

  async remove(mediaId: string): Promise<void> {
    // Removing from the library leaves progress/history intact (Aniyomi/Mihon behavior).
    this.entries.delete(mediaId)
    this.tombEntries.set(mediaId, Date.now())
  }

  async get(mediaId: string): Promise<LibraryEntry | undefined> {
    return this.entries.get(mediaId)
  }

  async list(): Promise<LibraryEntry[]> {
    return [...this.entries.values()].sort((a, b) => b.addedAt - a.addedAt)
  }

  async setSeen(mediaId: string, episodeId: string): Promise<void> {
    await this.setSeenMany(mediaId, [episodeId])
  }

  async setSeenMany(mediaId: string, episodeIds: string[]): Promise<void> {
    const existing = this.progress.get(mediaId)
    const seen = new Set(existing?.seenEpisodeIds ?? [])
    for (const id of episodeIds) seen.add(id)
    this.progress.set(mediaId, { mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() })
    this.tombProgress.delete(mediaId)
  }

  async unsetSeen(mediaId: string, episodeId: string): Promise<void> {
    await this.unsetSeenMany(mediaId, [episodeId])
  }

  async unsetSeenMany(mediaId: string, episodeIds: string[]): Promise<void> {
    const existing = this.progress.get(mediaId)
    if (!existing) return
    const seen = new Set(existing.seenEpisodeIds)
    for (const id of episodeIds) seen.delete(id)
    if (seen.size === 0) {
      this.progress.delete(mediaId)
      this.tombProgress.set(mediaId, Date.now())
    } else this.progress.set(mediaId, { mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() })
  }

  async getProgress(mediaId: string): Promise<ProgressEntry | undefined> {
    return this.progress.get(mediaId)
  }

  async addHistory(media: Media, episode: Episode): Promise<void> {
    this.history.set(episode.id, { media, episode, openedAt: Date.now() })
    this.tombHistory.delete(episode.id)
  }

  async listHistory(): Promise<HistoryEntry[]> {
    return [...this.history.values()].sort((a, b) => b.openedAt - a.openedAt)
  }

  async removeHistory(episodeId: string): Promise<void> {
    this.history.delete(episodeId)
    this.tombHistory.set(episodeId, Date.now())
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({
      version: 1,
      entries: [...this.entries.values()],
      progress: [...this.progress.values()],
      history: [...this.history.values()],
      tombstones: {
        entries: [...this.tombEntries].map(([id, deletedAt]) => ({ id, deletedAt })),
        progress: [...this.tombProgress].map(([id, deletedAt]) => ({ id, deletedAt })),
        history: [...this.tombHistory].map(([id, deletedAt]) => ({ id, deletedAt }))
      }
    })
  }

  async importJson(json: string): Promise<void> {
    const data = JSON.parse(json) as SyncPayload
    if (data.entries) for (const e of data.entries) this.entries.set(e.media.id, e)
    if (data.progress) for (const p of data.progress) this.progress.set(p.mediaId, p)
    if (data.history) for (const h of data.history) this.history.set(h.episode.id, h)
    for (const t of data.tombstones?.entries ?? []) {
      this.entries.delete(t.id)
      this.tombEntries.set(t.id, t.deletedAt)
    }
    for (const t of data.tombstones?.progress ?? []) {
      this.progress.delete(t.id)
      this.tombProgress.set(t.id, t.deletedAt)
    }
    for (const t of data.tombstones?.history ?? []) {
      this.history.delete(t.id)
      this.tombHistory.set(t.id, t.deletedAt)
    }
  }
}

/** In-memory plugin store used for tests and non-persistent scenarios. */
export class MemoryPluginStore implements PluginStore {
  private bundles = new Map<string, PluginStoredBundle>()

  async list(): Promise<PluginStoredBundle[]> {
    return [...this.bundles.values()]
  }

  async get(id: string): Promise<PluginStoredBundle | undefined> {
    return this.bundles.get(id)
  }

  async save(bundle: PluginStoredBundle): Promise<void> {
    this.bundles.set(bundle.id, bundle)
  }

  async remove(id: string): Promise<void> {
    this.bundles.delete(id)
  }
}

/** In-memory per-source preferences; the default backend when none is configured. */
export class MemoryPreferencesApi implements PreferencesApi {
  private prefs = new Map<string, PreferenceValue>()

  async get<T extends PreferenceValue>(sourceId: string, key: string): Promise<T | undefined> {
    return this.prefs.get(`${sourceId}\u0000${key}`) as T | undefined
  }

  async getWithDefault<T extends PreferenceValue>(sourceId: string, key: string, fallback: T): Promise<T> {
    return (await this.get<T>(sourceId, key)) ?? fallback
  }

  async set(sourceId: string, key: string, value: PreferenceValue): Promise<void> {
    this.prefs.set(`${sourceId}\u0000${key}`, value)
  }
}

function indexDBOpen(name: string, version: number): IDBOpenDBRequest {
  return (globalThis.indexedDB as IDBFactory).open(name, version)
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * IndexedDB-backed store used by the web (no-server) build.
 * Object stores: `library` (key = media id), `progress` (key = media id),
 * `history` (key = `${mediaId}/${episodeId}`), `preferences`, `plugins`.
 */
export class IndexedDbStore implements LibraryStore {
  static readonly DB_NAME = 'woyomi'
  static readonly VERSION = 4

  private dbPromise: Promise<IDBDatabase> | undefined

  constructor(private dbName = IndexedDbStore.DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexDBOpen(this.dbName, IndexedDbStore.VERSION)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => resolve(req.result)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'mediaId' })
          if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'key' })
          if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'key' })
          if (!db.objectStoreNames.contains('plugins')) db.createObjectStore('plugins', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('mediaPages')) db.createObjectStore('mediaPages', { keyPath: 'id' })
        }
      })
    }
    return this.dbPromise
  }

  /** Reuses this store's open IndexedDB handle; shares the library DB file. */
  pluginStore(): IndexedDbPluginStore {
    return new IndexedDbPluginStore(this.db.bind(this))
  }

  /** Reuses this store's open IndexedDB handle; shares the library DB file. */
  preferencesApi(): IndexedDbPreferencesApi {
    return new IndexedDbPreferencesApi(this.db.bind(this))
  }

  /** Reuses this store's open IndexedDB handle; shares the library DB file. */
  mediaPageCache(): IndexedDbMediaPageCache {
    return new IndexedDbMediaPageCache(this.db.bind(this))
  }

  async add(media: Media, status: LibraryStatus): Promise<void> {
    const db = await this.db()
    const existing = await this.get(media.id)
    const meta: LibraryEntry = { ...existing, media, status, addedAt: existing?.addedAt ?? Date.now(), updatedAt: Date.now() }
    await new Promise((resolve, reject) => {
      const tx = db.transaction('library', 'readwrite')
      tx.objectStore('library').put({ ...media, meta })
      tx.oncomplete = () => resolve(null)
      tx.onerror = () => reject(tx.error)
    })
    await this.clearTombstone('entries', media.id)
  }

  async updateStatus(mediaId: string, status: LibraryStatus): Promise<void> {
    await this.updateMeta(mediaId, (meta) => ({ ...meta, status, updatedAt: Date.now() }))
  }

  async remove(mediaId: string): Promise<void> {
    const db = await this.db()
    // Removing from the library leaves progress/history intact (Aniyomi/Mihon behavior).
    await request(db.transaction('library', 'readwrite').objectStore('library').delete(mediaId)).then(() => undefined)
    await this.putTombstone('entries', mediaId)
  }

  async get(mediaId: string): Promise<LibraryEntry | undefined> {
    const db = await this.db()
    return request<{ meta: LibraryEntry } | undefined>(db.transaction('library', 'readonly').objectStore('library').get(mediaId)).then((row) => row?.meta)
  }

  async list(): Promise<LibraryEntry[]> {
    const db = await this.db()
    const rows = await request<{ meta: LibraryEntry }[]>(db.transaction('library', 'readonly').objectStore('library').getAll())
    return rows.map((r) => r.meta).sort((a, b) => b.addedAt - a.addedAt)
  }

  async setSeen(mediaId: string, episodeId: string): Promise<void> {
    await this.setSeenMany(mediaId, [episodeId])
  }

  async setSeenMany(mediaId: string, episodeIds: string[]): Promise<void> {
    const db = await this.db()
    const existing = await this.getProgress(mediaId)
    const seen = new Set(existing?.seenEpisodeIds ?? [])
    for (const id of episodeIds) seen.add(id)
    const row: ProgressEntry = { mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() }
    await request(db.transaction('progress', 'readwrite').objectStore('progress').put(row)).then(() => undefined)
    await this.clearTombstone('progress', mediaId)
  }

  async unsetSeen(mediaId: string, episodeId: string): Promise<void> {
    await this.unsetSeenMany(mediaId, [episodeId])
  }

  async unsetSeenMany(mediaId: string, episodeIds: string[]): Promise<void> {
    const db = await this.db()
    const existing = await this.getProgress(mediaId)
    if (!existing) return
    const seen = new Set(existing.seenEpisodeIds)
    for (const id of episodeIds) seen.delete(id)
    const store = db.transaction('progress', 'readwrite').objectStore('progress')
    if (seen.size === 0) {
      await request(store.delete(mediaId)).then(() => undefined)
      await this.putTombstone('progress', mediaId)
    } else await request(store.put({ mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() })).then(() => undefined)
  }

  async getProgress(mediaId: string): Promise<ProgressEntry | undefined> {
    const db = await this.db()
    return request<ProgressEntry | undefined>(db.transaction('progress', 'readonly').objectStore('progress').get(mediaId))
  }

  async addHistory(media: Media, episode: Episode): Promise<void> {
    const db = await this.db()
    const row = { key: episode.id, media, episode, openedAt: Date.now() }
    await request(db.transaction('history', 'readwrite').objectStore('history').put(row)).then(() => undefined)
    await this.clearTombstone('history', episode.id)
  }

  async listHistory(): Promise<HistoryEntry[]> {
    const db = await this.db()
    const rows = await request<Array<{ media: Media; episode: Episode; openedAt: number }>>(
      db.transaction('history', 'readonly').objectStore('history').getAll()
    )
    return rows.map((r) => ({ media: r.media, episode: r.episode, openedAt: r.openedAt })).sort((a, b) => b.openedAt - a.openedAt)
  }

  async removeHistory(episodeId: string): Promise<void> {
    const db = await this.db()
    await request(db.transaction('history', 'readwrite').objectStore('history').delete(episodeId)).then(() => undefined)
    await this.putTombstone('history', episodeId)
  }

  async exportJson(): Promise<string> {
    const entries = await this.list()
    const progress: ProgressEntry[] = []
    for (const e of entries) {
      const p = await this.getProgress(e.media.id)
      if (p) progress.push(p)
    }
    const tombstones = await this.readTombstones()
    return JSON.stringify({ version: 1, entries, progress, history: await this.listHistory(), tombstones })
  }

  async importJson(json: string): Promise<void> {
    const data = JSON.parse(json) as SyncPayload
    const db = await this.db()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['library', 'progress', 'history'], 'readwrite')
      const ls = tx.objectStore('library')
      const ps = tx.objectStore('progress')
      const hs = tx.objectStore('history')
      for (const e of data.entries ?? []) ls.put({ ...e.media, meta: e })
      for (const p of data.progress ?? []) ps.put(p)
      for (const h of data.history ?? []) hs.put({ key: h.episode.id, ...h })
      tx.oncomplete = () => resolve(null)
      tx.onerror = () => reject(tx.error)
    })
    await this.setTombstones(data.tombstones)
  }

  private async updateMeta(mediaId: string, updater: (meta: LibraryEntry) => LibraryEntry): Promise<void> {
    const meta = await this.get(mediaId)
    if (!meta) return
    const db = await this.db()
    return request(db.transaction('library', 'readwrite').objectStore('library').put({ ...meta.media, meta: updater(meta) })).then(() => undefined)
  }

  // Tombstones persist in the `preferences` object store under a reserved key
  // (reuses the DB handle + schema, no migration). The map is id -> deletedAt.
  // ponytail: tombstones are never GC'd here. Add pruning when they measurably grow.
  private async readTombstones(): Promise<SyncEdits> {
    const db = await this.db()
    const row = await request<{ value: SyncEdits } | undefined>(db.transaction('preferences', 'readonly').objectStore('preferences').get('__app/sync.tombstones'))
    return (
      row?.value ?? {
        entries: [],
        progress: [],
        history: []
      }
    )
  }

  private async setTombstones(t: SyncEdits): Promise<void> {
    const db = await this.db()
    await request(db.transaction('preferences', 'readwrite').objectStore('preferences').put({ key: '__app/sync.tombstones', value: t })).then(
      () => undefined
    )
  }

  private async putTombstone(kind: 'entries' | 'progress' | 'history', id: string): Promise<void> {
    const t = await this.readTombstones()
    const list = t[kind].filter((x) => x.id !== id)
    list.push({ id, deletedAt: Date.now() })
    await this.setTombstones({ ...t, [kind]: list })
  }

  private async clearTombstone(kind: 'entries' | 'progress' | 'history', id: string): Promise<void> {
    const t = await this.readTombstones()
    const list = t[kind].filter((x) => x.id !== id)
    if (list.length !== t[kind].length) await this.setTombstones({ ...t, [kind]: list })
  }
}

/** Local, non-syncing cache of media details and episode lists. */
export class IndexedDbMediaPageCache implements MediaPageCache {
  constructor(private db: () => Promise<IDBDatabase>) {}

  async get(mediaId: string): Promise<CachedMediaPage | undefined> {
    const db = await this.db()
    const row = await request<{ page: CachedMediaPage } | undefined>(db.transaction('mediaPages', 'readonly').objectStore('mediaPages').get(mediaId))
    return row?.page
  }

  async save(mediaId: string, page: CachedMediaPage): Promise<void> {
    const db = await this.db()
    await request(db.transaction('mediaPages', 'readwrite').objectStore('mediaPages').put({ id: mediaId, page })).then(() => undefined)
  }
}

/** `PluginStore` over the `plugins` object store of the same IndexedDB database. */
export class IndexedDbPluginStore implements PluginStore {
  constructor(private db: () => Promise<IDBDatabase>) {}

  async list(): Promise<PluginStoredBundle[]> {
    const db = await this.db()
    const rows = await request<PluginStoredBundle[]>(db.transaction('plugins', 'readonly').objectStore('plugins').getAll())
    return rows
  }

  async get(id: string): Promise<PluginStoredBundle | undefined> {
    const db = await this.db()
    return request<PluginStoredBundle | undefined>(db.transaction('plugins', 'readonly').objectStore('plugins').get(id))
  }

  async save(bundle: PluginStoredBundle): Promise<void> {
    const db = await this.db()
    return request(db.transaction('plugins', 'readwrite').objectStore('plugins').put(bundle)).then(() => undefined)
  }

  async remove(id: string): Promise<void> {
    const db = await this.db()
    return request(db.transaction('plugins', 'readwrite').objectStore('plugins').delete(id)).then(() => undefined)
  }
}

/** `PreferencesApi` over the `preferences` object store of the same IndexedDB database. */
export class IndexedDbPreferencesApi implements PreferencesApi {
  constructor(private db: () => Promise<IDBDatabase>) {}

  async get<T extends PreferenceValue>(sourceId: string, key: string): Promise<T | undefined> {
    const db = await this.db()
    const row = await request<{ value: PreferenceValue } | undefined>(
      db.transaction('preferences', 'readonly').objectStore('preferences').get(`${sourceId}/${key}`)
    )
    return row?.value as T | undefined
  }

  async getWithDefault<T extends PreferenceValue>(sourceId: string, key: string, fallback: T): Promise<T> {
    return (await this.get<T>(sourceId, key)) ?? fallback
  }

  async set(sourceId: string, key: string, value: PreferenceValue): Promise<void> {
    const db = await this.db()
    return request(db.transaction('preferences', 'readwrite').objectStore('preferences').put({ key: `${sourceId}/${key}`, value })).then(
      () => undefined
    )
  }
}
