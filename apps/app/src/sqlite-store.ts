import Database from '@tauri-apps/plugin-sql'
import type { CachedMediaPage, MediaPageCache, PluginStore, PluginStoredBundle, PreferencesApi, PreferenceValue } from '@woyomi/core'
import type { LibraryEntry, LibraryStatus, Media, Episode, HistoryEntry, ProgressEntry, SyncEdits, SyncPayload } from '@woyomi/core'
import type { LibraryStore } from '@woyomi/core'
import type { DownloadRecord, DownloadStore } from './downloads'

/**
 * SQLite-backed LibraryStore for the Tauri native build, via tauri-plugin-sql
 * (raw SQL, no ORM). Tables mirror the IndexedDB shapes. Values are stored as
 * JSON strings; rows are keyed the same way as the web build.
 */
export class SqliteStore implements LibraryStore {
  private dbPromise: Promise<Database> | undefined

  constructor(private path = 'sqlite:woyomi.db') {}

  private db(): Promise<Database> {
    if (!this.dbPromise) {
      this.dbPromise = Database.load(this.path).then(async (db) => {
        await db.execute(`CREATE TABLE IF NOT EXISTS library (
          id TEXT PRIMARY KEY,
          meta TEXT NOT NULL
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS progress (
          media_id TEXT PRIMARY KEY,
          seen TEXT NOT NULL
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS history (
          episode_id TEXT PRIMARY KEY,
          row TEXT NOT NULL
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS preferences (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS plugins (
          id TEXT PRIMARY KEY,
          bundle TEXT NOT NULL
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS downloads (
          id TEXT PRIMARY KEY,
          row TEXT NOT NULL
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS media_pages (
          id TEXT PRIMARY KEY,
          row TEXT NOT NULL
        )`)
        return db
      })
    }
    return this.dbPromise
  }

  async add(media: Media, status: LibraryStatus): Promise<void> {
    const db = await this.db()
    const existing = await this.get(media.id)
    const meta: LibraryEntry = { media, status, addedAt: existing?.addedAt ?? Date.now(), updatedAt: Date.now() }
    await db.execute('INSERT OR REPLACE INTO library (id, meta) VALUES ($1, $2)', [media.id, JSON.stringify(meta)])
    await this.clearTombstone('entries', media.id)
  }

  async updateStatus(mediaId: string, status: LibraryStatus): Promise<void> {
    const meta = await this.get(mediaId)
    if (!meta) return
    await this.add(meta.media, status)
  }

  async remove(mediaId: string): Promise<void> {
    // Removing from the library leaves progress/history intact (Aniyomi/Mihon behavior).
    const db = await this.db()
    await db.execute('DELETE FROM library WHERE id = $1', [mediaId])
    await this.putTombstone('entries', mediaId)
  }

  async get(mediaId: string): Promise<LibraryEntry | undefined> {
    const db = await this.db()
    const rows = await db.select<Array<{ meta: string }>>('SELECT meta FROM library WHERE id = $1', [mediaId])
    return rows[0] ? (JSON.parse(rows[0].meta) as LibraryEntry) : undefined
  }

  async list(): Promise<LibraryEntry[]> {
    const db = await this.db()
    const rows = await db.select<Array<{ meta: string }>>('SELECT meta FROM library')
    return rows.map((r) => JSON.parse(r.meta) as LibraryEntry).sort((a, b) => b.addedAt - a.addedAt)
  }

  async setSeen(mediaId: string, episodeId: string): Promise<void> {
    await this.setSeenMany(mediaId, [episodeId])
  }

  async setSeenMany(mediaId: string, episodeIds: string[]): Promise<void> {
    const existing = await this.getProgress(mediaId)
    const seen = new Set(existing?.seenEpisodeIds ?? [])
    for (const id of episodeIds) seen.add(id)
    const progress: ProgressEntry = { mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() }
    const db = await this.db()
    await db.execute('INSERT OR REPLACE INTO progress (media_id, seen) VALUES ($1, $2)', [mediaId, JSON.stringify(progress)])
    await this.clearTombstone('progress', mediaId)
  }

  async unsetSeen(mediaId: string, episodeId: string): Promise<void> {
    await this.unsetSeenMany(mediaId, [episodeId])
  }

  async unsetSeenMany(mediaId: string, episodeIds: string[]): Promise<void> {
    const existing = await this.getProgress(mediaId)
    if (!existing) return
    const seen = new Set(existing.seenEpisodeIds)
    for (const id of episodeIds) seen.delete(id)
    const db = await this.db()
    if (seen.size === 0) {
      await db.execute('DELETE FROM progress WHERE media_id = $1', [mediaId])
      await this.putTombstone('progress', mediaId)
    } else {
      const progress: ProgressEntry = { mediaId, seenEpisodeIds: [...seen], updatedAt: Date.now() }
      await db.execute('INSERT OR REPLACE INTO progress (media_id, seen) VALUES ($1, $2)', [mediaId, JSON.stringify(progress)])
    }
  }

  async getProgress(mediaId: string): Promise<ProgressEntry | undefined> {
    const db = await this.db()
    const rows = await db.select<Array<{ seen: string }>>('SELECT seen FROM progress WHERE media_id = $1', [mediaId])
    return rows[0] ? (JSON.parse(rows[0].seen) as ProgressEntry) : undefined
  }

  async addHistory(media: Media, episode: Episode): Promise<void> {
    const entry: HistoryEntry = { media, episode, openedAt: Date.now() }
    const db = await this.db()
    await db.execute('INSERT OR REPLACE INTO history (episode_id, row) VALUES ($1, $2)', [episode.id, JSON.stringify(entry)])
    await this.clearTombstone('history', episode.id)
  }

  async listHistory(): Promise<HistoryEntry[]> {
    const db = await this.db()
    const rows = await db.select<Array<{ row: string }>>('SELECT row FROM history')
    return rows.map((r) => JSON.parse(r.row) as HistoryEntry).sort((a, b) => b.openedAt - a.openedAt)
  }

  async removeHistory(episodeId: string): Promise<void> {
    const db = await this.db()
    await db.execute('DELETE FROM history WHERE episode_id = $1', [episodeId])
    await this.putTombstone('history', episodeId)
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({
      version: 1,
      entries: await this.list(),
      progress: await this.listProgress(),
      history: await this.listHistory(),
      tombstones: await this.readTombstones()
    })
  }

  async importJson(json: string): Promise<void> {
    const data = JSON.parse(json) as SyncPayload
    const db = await this.db()
    for (const e of data.entries ?? []) await db.execute('INSERT OR REPLACE INTO library (id, meta) VALUES ($1, $2)', [e.media.id, JSON.stringify(e)])
    for (const p of data.progress ?? []) await db.execute('INSERT OR REPLACE INTO progress (media_id, seen) VALUES ($1, $2)', [p.mediaId, JSON.stringify(p)])
    for (const h of data.history ?? []) {
      const entry: HistoryEntry = { media: h.media, episode: h.episode, openedAt: h.openedAt }
      await db.execute('INSERT OR REPLACE INTO history (episode_id, row) VALUES ($1, $2)', [h.episode.id, JSON.stringify(entry)])
    }
    await this.setTombstones(data.tombstones)
  }

  private async listProgress(): Promise<ProgressEntry[]> {
    const db = await this.db()
    const rows = await db.select<Array<{ seen: string }>>('SELECT seen FROM progress')
    return rows.map((r) => JSON.parse(r.seen) as ProgressEntry)
  }

  // Tombstones live in the `preferences` table under a reserved key (no schema
  // change). Map is id -> deletedAt. ponytail: never GC'd here.
  private async readTombstones(): Promise<SyncEdits> {
    const db = await this.db()
    const rows = await db.select<Array<{ value: string }>>('SELECT value FROM preferences WHERE key = $1', ['__app/sync.tombstones'])
    return rows[0] ? (JSON.parse(rows[0].value) as SyncEdits) : { entries: [], progress: [], history: [] }
  }

  private async setTombstones(t: SyncEdits): Promise<void> {
    const db = await this.db()
    await db.execute('INSERT OR REPLACE INTO preferences (key, value) VALUES ($1, $2)', ['__app/sync.tombstones', JSON.stringify(t)])
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

  /** Reuses this store's database connection; shares the SQLite file. */
  pluginStore(): SqlitePluginStore {
    return new SqlitePluginStore(this.db.bind(this))
  }

  /** Reuses this store's database connection; shares the SQLite file. */
  preferencesApi(): SqlitePreferencesApi {
    return new SqlitePreferencesApi(this.db.bind(this))
  }

  /** Reuses this store's database connection; shares the SQLite file. */
  downloadStore(): SqliteDownloadStore {
    return new SqliteDownloadStore(this.db.bind(this))
  }

  /** Reuses this store's database connection; shares the SQLite file. */
  mediaPageCache(): SqliteMediaPageCache {
    return new SqliteMediaPageCache(this.db.bind(this))
  }
}

/** Local, non-syncing cache of media details and episode lists. */
export class SqliteMediaPageCache implements MediaPageCache {
  constructor(private db: () => Promise<Database>) {}

  async get(mediaId: string): Promise<CachedMediaPage | undefined> {
    const db = await this.db()
    const rows = await db.select<Array<{ row: string }>>('SELECT row FROM media_pages WHERE id = $1', [mediaId])
    return rows[0] ? (JSON.parse(rows[0].row) as CachedMediaPage) : undefined
  }

  async save(mediaId: string, page: CachedMediaPage): Promise<void> {
    const db = await this.db()
    await db.execute('INSERT OR REPLACE INTO media_pages (id, row) VALUES ($1, $2)', [mediaId, JSON.stringify(page)])
  }
}

/** `DownloadStore` over the `downloads` table of the same SQLite database. */
export class SqliteDownloadStore implements DownloadStore {
  constructor(private db: () => Promise<Database>) {}

  async list(): Promise<DownloadRecord[]> {
    const db = await this.db()
    const rows = await db.select<Array<{ row: string }>>('SELECT row FROM downloads')
    return rows.map((item) => JSON.parse(item.row) as DownloadRecord).sort((a, b) => a.createdAt - b.createdAt)
  }

  async get(id: string): Promise<DownloadRecord | undefined> {
    const db = await this.db()
    const rows = await db.select<Array<{ row: string }>>('SELECT row FROM downloads WHERE id = $1', [id])
    return rows[0] ? (JSON.parse(rows[0].row) as DownloadRecord) : undefined
  }

  async save(record: DownloadRecord): Promise<void> {
    const db = await this.db()
    await db.execute('INSERT OR REPLACE INTO downloads (id, row) VALUES ($1, $2)', [record.id, JSON.stringify(record)])
  }

  async remove(id: string): Promise<void> {
    const db = await this.db()
    await db.execute('DELETE FROM downloads WHERE id = $1', [id])
  }
}

/** `PluginStore` over the `plugins` table of the same SQLite database. */
export class SqlitePluginStore implements PluginStore {
  constructor(private db: () => Promise<Database>) {}

  async list(): Promise<PluginStoredBundle[]> {
    const db = await this.db()
    const rows = await db.select<Array<{ bundle: string }>>('SELECT bundle FROM plugins')
    return rows.map((r) => JSON.parse(r.bundle) as PluginStoredBundle)
  }

  async get(id: string): Promise<PluginStoredBundle | undefined> {
    const db = await this.db()
    const rows = await db.select<Array<{ bundle: string }>>('SELECT bundle FROM plugins WHERE id = $1', [id])
    return rows[0] ? (JSON.parse(rows[0].bundle) as PluginStoredBundle) : undefined
  }

  async save(bundle: PluginStoredBundle): Promise<void> {
    const db = await this.db()
    await db.execute('INSERT OR REPLACE INTO plugins (id, bundle) VALUES ($1, $2)', [bundle.id, JSON.stringify(bundle)])
  }

  async remove(id: string): Promise<void> {
    const db = await this.db()
    await db.execute('DELETE FROM plugins WHERE id = $1', [id])
  }
}

/** `PreferencesApi` over the `preferences` table of the same SQLite database. */
export class SqlitePreferencesApi implements PreferencesApi {
  constructor(private db: () => Promise<Database>) {}

  async get<T extends PreferenceValue>(sourceId: string, key: string): Promise<T | undefined> {
    const db = await this.db()
    const rows = await db.select<Array<{ value: string }>>('SELECT value FROM preferences WHERE key = $1', [`${sourceId}/${key}`])
    return rows[0] ? (JSON.parse(rows[0].value) as T) : undefined
  }

  async getWithDefault<T extends PreferenceValue>(sourceId: string, key: string, fallback: T): Promise<T> {
    return (await this.get<T>(sourceId, key)) ?? fallback
  }

  async set(sourceId: string, key: string, value: PreferenceValue): Promise<void> {
    const db = await this.db()
    await db.execute('INSERT OR REPLACE INTO preferences (key, value) VALUES ($1, $2)', [`${sourceId}/${key}`, JSON.stringify(value)])
  }
}
