import type { LibraryEntry, LibraryStatus, LibraryStore, Media, ProgressEntry } from './types.js'

/** In-memory store used for tests and non-persistent scenarios. */
export class MemoryStore implements LibraryStore {
  private entries = new Map<string, LibraryEntry>()
  private progress = new Map<string, ProgressEntry>()

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

  async getProgress(mediaId: string): Promise<ProgressEntry | undefined> {
    return this.progress.get(mediaId)
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({ version: 1, entries: [...this.entries.values()], progress: [...this.progress.values()] })
  }

  async importJson(json: string): Promise<void> {
    const data = JSON.parse(json) as { version: number; entries?: LibraryEntry[]; progress?: ProgressEntry[] }
    if (data.entries) for (const e of data.entries) this.entries.set(e.media.id, e)
    if (data.progress) for (const p of data.progress) this.progress.set(p.mediaId, p)
  }
}

/**
 * IndexedDB-backed store used by the web (no-server) build.
 * Two object stores: `library` (key = media id) and `progress` (key = media id).
 */
export class IndexedDbStore implements LibraryStore {
  static readonly DB_NAME = 'media-platform'
  static readonly VERSION = 1

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
        }
      })
    }
    return this.dbPromise
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
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['library', 'progress'], 'readwrite')
      tx.objectStore('library').delete(mediaId)
      tx.objectStore('progress').delete(mediaId)
      tx.oncomplete = () => resolve(null)
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

  async getProgress(mediaId: string): Promise<ProgressEntry | undefined> {
    const db = await this.db()
    return request<ProgressEntry | undefined>(db.transaction('progress', 'readonly').objectStore('progress').get(mediaId))
  }

  async exportJson(): Promise<string> {
    const entries = await this.list()
    const progress: ProgressEntry[] = []
    for (const e of entries) {
      const p = await this.getProgress(e.media.id)
      if (p) progress.push(p)
    }
    return JSON.stringify({ version: 1, entries, progress })
  }

  async importJson(json: string): Promise<void> {
    const data = JSON.parse(json) as { version: number; entries?: LibraryEntry[]; progress?: ProgressEntry[] }
    const db = await this.db()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['library', 'progress'], 'readwrite')
      const ls = tx.objectStore('library')
      const ps = tx.objectStore('progress')
      for (const e of data.entries ?? []) ls.put({ ...e.media, meta: e })
      for (const p of data.progress ?? []) ps.put(p)
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

function indexDBOpen(name: string, version: number): IDBOpenDBRequest {
  return (globalThis.indexedDB as IDBFactory).open(name, version)
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}