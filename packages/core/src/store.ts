import type {
  Episode,
  HistoryEntry,
  LibraryEntry,
  LibraryStatus,
  LibraryStore,
  Media,
  PluginStoredBundle,
  PluginStore,
  PreferencesApi,
  PreferenceValue,
  ProgressEntry
} from './types.js'

/** In-memory store used for tests and non-persistent scenarios. */
export class MemoryStore implements LibraryStore {
  private entries = new Map<string, LibraryEntry>()
  private progress = new Map<string, ProgressEntry>()
  private history = new Map<string, HistoryEntry>()

  async add(media: Media, status: LibraryStatus): Promise<void> {
    this.entries.set(media.id, { media, status, addedAt: this.entries.get(media.id)?.addedAt ?? Date.now() })
  }

  async updateStatus(mediaId: string, status: LibraryStatus): Promise<void> {
    const entry = this.entries.get(mediaId)
    if (entry) entry.status = status
  }

  async remove(mediaId: string): Promise<void> {
    this.entries.delete(mediaId)
    this.progress.delete(mediaId)
    for (const [key, h] of [...this.history]) {
      if (h.media.id === mediaId) this.history.delete(key)
    }
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
  }

  async unsetSeen(mediaId: string, episodeId: string): Promise<void> {
    await this.unsetSeenMany(mediaId, [episodeId])
  }

  async unsetSeenMany(mediaId: string, episodeIds: string[]): Promise<void> {
    const existing = this.progress.get(mediaId)
    if (!existing) return
    const seen = new Set(existing.seenEpisodeIds)
    for (const id of episodeIds) seen.delete(id)
    if (seen.size === 0) this.progress.delete(mediaId)
    else this.progress.set(mediaId, { mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() })
  }

  async getProgress(mediaId: string): Promise<ProgressEntry | undefined> {
    return this.progress.get(mediaId)
  }

  async addHistory(media: Media, episode: Episode): Promise<void> {
    this.history.set(episode.id, { media, episode, openedAt: Date.now() })
  }

  async listHistory(): Promise<HistoryEntry[]> {
    return [...this.history.values()].sort((a, b) => b.openedAt - a.openedAt)
  }

  async removeHistory(episodeId: string): Promise<void> {
    this.history.delete(episodeId)
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({
      version: 1,
      entries: [...this.entries.values()],
      progress: [...this.progress.values()],
      history: [...this.history.values()]
    })
  }

  async importJson(json: string): Promise<void> {
    const data = JSON.parse(json) as { version: number; entries?: LibraryEntry[]; progress?: ProgressEntry[]; history?: HistoryEntry[] }
    if (data.entries) for (const e of data.entries) this.entries.set(e.media.id, e)
    if (data.progress) for (const p of data.progress) this.progress.set(p.mediaId, p)
    if (data.history) for (const h of data.history) this.history.set(h.episode.id, h)
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
  static readonly DB_NAME = 'media-platform'
  static readonly VERSION = 3

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

  async add(media: Media, status: LibraryStatus): Promise<void> {
    const db = await this.db()
    const existing = await this.get(media.id)
    const row = { ...media, _status: status, _addedAt: existing != null ? Date.now() : 0 }
    if (row._addedAt === 0) row._addedAt = Date.now()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('library', 'readwrite')
      tx.objectStore('library').put({ ...media, meta: { media, status, addedAt: row._addedAt } })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async updateStatus(mediaId: string, status: LibraryStatus): Promise<void> {
    await this.updateMeta(mediaId, (meta) => ({ ...meta, status }))
  }

  async remove(mediaId: string): Promise<void> {
    const db = await this.db()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['library', 'progress', 'history'], 'readwrite')
      tx.objectStore('library').delete(mediaId)
      tx.objectStore('progress').delete(mediaId)
      const hs = tx.objectStore('history')
      void request<Array<{ key: string; media: Media }>>(hs.getAll()).then((rows) => {
        for (const h of rows) if (h.media.id === mediaId) void request(hs.delete(h.key))
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
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
    return request(db.transaction('progress', 'readwrite').objectStore('progress').put(row)).then(() => undefined)
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
    if (seen.size === 0) return request(store.delete(mediaId)).then(() => undefined)
    return request(store.put({ mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() })).then(() => undefined)
  }

  async getProgress(mediaId: string): Promise<ProgressEntry | undefined> {
    const db = await this.db()
    return request<ProgressEntry | undefined>(db.transaction('progress', 'readonly').objectStore('progress').get(mediaId))
  }

  async addHistory(media: Media, episode: Episode): Promise<void> {
    const db = await this.db()
    const row = { key: episode.id, media, episode, openedAt: Date.now() }
    return request(db.transaction('history', 'readwrite').objectStore('history').put(row)).then(() => undefined)
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
    return request(db.transaction('history', 'readwrite').objectStore('history').delete(episodeId)).then(() => undefined)
  }

  async exportJson(): Promise<string> {
    const entries = await this.list()
    const progress: ProgressEntry[] = []
    for (const e of entries) {
      const p = await this.getProgress(e.media.id)
      if (p) progress.push(p)
    }
    return JSON.stringify({ version: 1, entries, progress, history: await this.listHistory() })
  }

  async importJson(json: string): Promise<void> {
    const data = JSON.parse(json) as { version: number; entries?: LibraryEntry[]; progress?: ProgressEntry[]; history?: HistoryEntry[] }
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
  }

  private async updateMeta(mediaId: string, updater: (meta: LibraryEntry) => LibraryEntry): Promise<void> {
    const meta = await this.get(mediaId)
    if (!meta) return
    const db = await this.db()
    return request(db.transaction('library', 'readwrite').objectStore('library').put({ ...meta.media, meta: updater(meta) })).then(() => undefined)
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