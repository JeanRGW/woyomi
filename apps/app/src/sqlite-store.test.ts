import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '@woyomi/core'

const { dbs, FakeDb } = vi.hoisted(() => {
  class FakeDb {
    tables = new Map<string, Map<string, string>>()
    table(name: string): Map<string, string> {
      let table = this.tables.get(name)
      if (!table) {
        table = new Map()
        this.tables.set(name, table)
      }
      return table
    }
    async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
      if (sql.startsWith('CREATE TABLE')) return { rowsAffected: 0 }
      const insert = /^INSERT OR REPLACE INTO (\w+)/.exec(sql)
      if (insert) {
        this.table(insert[1]!).set(String(params[0]), String(params[1]))
        return { rowsAffected: 1 }
      }
      const del = /^DELETE FROM (\w+)/.exec(sql)
      if (del) {
        this.table(del[1]!).delete(String(params[0]))
        return { rowsAffected: 1 }
      }
      throw new Error(`fake sqlite: unsupported execute: ${sql}`)
    }
    async select(sql: string, params: unknown[] = []): Promise<Array<Record<string, string>>> {
      const withWhere = /^SELECT (\w+) FROM (\w+) WHERE/.exec(sql)
      const all = /^SELECT (\w+) FROM (\w+)$/.exec(sql)
      const match = withWhere ?? all
      if (!match) throw new Error(`fake sqlite: unsupported select: ${sql}`)
      const [, column, table] = match
      const rows = this.table(table!)
      const values = withWhere
        ? rows.has(String(params[0]))
          ? [rows.get(String(params[0]))!]
          : []
        : [...rows.values()]
      return values.map((value) => ({ [column!]: value }))
    }
  }
  return { dbs: new Map<string, InstanceType<typeof FakeDb>>(), FakeDb }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async (path: string) => {
      let db = dbs.get(path)
      if (!db) {
        db = new FakeDb()
        dbs.set(path, db)
      }
      return db
    }
  }
}))

import { SqliteStore } from './sqlite-store'

function media(id: string): Media {
  return { id, title: `Title ${id}`, type: 'manga', mediaId: id.split('/')[1] ?? id, sourceId: 's' }
}

let dbCounter = 0
let db: InstanceType<typeof FakeDb>
let store: SqliteStore

beforeEach(() => {
  const path = `sqlite:test-${(dbCounter += 1)}.db`
  db = new FakeDb()
  dbs.set(path, db)
  store = new SqliteStore(path)
})

describe('SqliteStore', () => {
  it('adds, updates and removes entries with tombstones', async () => {
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

  it('does not let a stale import clobber newer local rows', async () => {
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

  it('preserves newer unread changes when importing progress', async () => {
    const snapshot = (seenEpisodeIds: string[], updatedAt: number) => JSON.stringify({
      progress: [{ mediaId: 's/1', seenEpisodeIds, updatedAt }]
    })
    await store.importJson(snapshot(['e1', 'e2'], 100))
    await store.importJson(snapshot(['e2'], 200))
    expect((await store.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e2'])
    await store.importJson(snapshot(['e1', 'e2'], 100))
    expect((await store.getProgress('s/1'))?.seenEpisodeIds).toEqual(['e2'])
  })

  it('adopts newer incoming rows and merges tombstones', async () => {
    await store.add(media('s/1'), 'reading')
    await store.add(media('s/2'), 'reading')
    await store.remove('s/2')

    const incoming = JSON.stringify({
      version: 1,
      entries: [{ media: media('s/3'), status: 'plan', addedAt: Date.now() + 5000, updatedAt: Date.now() + 5000 }],
      progress: [],
      history: [],
      tombstones: { entries: [], progress: [], history: [] }
    })
    await store.importJson(incoming)

    const exported = JSON.parse(await store.exportJson()) as {
      entries: Array<{ media: { id: string } }>
      tombstones: { entries: Array<{ id: string }> }
    }
    expect(exported.entries.map((e) => e.media.id).sort()).toEqual(['s/1', 's/3'])
    expect(exported.tombstones.entries.map((t) => t.id)).toEqual(['s/2'])
  })

  it('skips corrupt rows instead of crashing list paths', async () => {
    await store.add(media('s/1'), 'reading')
    db.table('library').set('s/bad', '{not json')
    db.table('library').set('s/invalid', JSON.stringify({ nope: true }))

    const rows = await store.list()
    expect(rows.map((r) => r.media.id)).toEqual(['s/1'])
  })

  it('rejects invalid payloads without touching local state', async () => {
    await store.add(media('s/1'), 'reading')

    await expect(store.importJson('{"entries": [{"nope": true}]}')).rejects.toThrow('invalid sync payload')
    expect(await store.list()).toHaveLength(1)
  })
})
