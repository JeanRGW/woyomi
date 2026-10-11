import { SyncPayloadSchema } from './protocol.js'
import type { HistoryEntry, LibraryEntry, ProgressEntry, SyncEdits, SyncPayload, SyncTombstone } from './types.js'

/**
 * Parse and validate a sync payload (server response or backup file).
 * Throws a descriptive error on malformed data instead of adopting it blindly.
 */
export function parseSyncPayload(json: string): SyncPayload {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('invalid sync payload: malformed JSON')
  }
  const result = SyncPayloadSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.join('.') ?? 'payload'
    throw new Error(`invalid sync payload: ${where} ${issue?.message ?? 'is invalid'}`)
  }
  return result.data
}

/** Last mutation time of a live record; legacy entries without `updatedAt` count as `addedAt`. */
function entryTs(e: LibraryEntry): number {
  return e.updatedAt ?? e.addedAt
}

function progressTs(p: ProgressEntry): number {
  return p.updatedAt
}

function historyTs(h: HistoryEntry): number {
  return h.openedAt
}

/** Union tombstone lists by id, keeping the latest `deletedAt` per id. */
function mergeTombstoneLists(prev: SyncTombstone[], inc: SyncTombstone[]): SyncTombstone[] {
  const byId = new Map<string, number>()
  for (const t of [...prev, ...inc]) {
    const kept = byId.get(t.id)
    if (kept === undefined || t.deletedAt > kept) byId.set(t.id, t.deletedAt)
  }
  return [...byId].map(([id, deletedAt]) => ({ id, deletedAt }))
}

/** Fill missing collections so callers may pass partial payloads (older stored states, test fixtures). */
function normalize(p: SyncPayload): Required<Pick<SyncPayload, 'entries' | 'progress' | 'history' | 'tombstones'>> {
  return {
    entries: p.entries ?? [],
    progress: p.progress ?? [],
    history: p.history ?? [],
    tombstones: {
      entries: p.tombstones?.entries ?? [],
      progress: p.tombstones?.progress ?? [],
      history: p.tombstones?.history ?? []
    }
  }
}

/**
 * Merge two full payloads with last-write-wins per record: a tombstone (deletion)
 * beats a live row only when it is strictly newer, and a newer live row
 * resurrects over an older tombstone. Progress rows merge additively (union of
 * seen episode ids, newest `updatedAt`).
 *
 * This is the single merge implementation shared by the sync server and every
 * `LibraryStore.importJson`, so all devices apply identical semantics.
 */
export function mergeSyncPayload(prev: SyncPayload, inc: SyncPayload): SyncPayload {
  const p = normalize(prev)
  const i = normalize(inc)
  const prevEntries = new Map(p.entries.map((e) => [e.media.id, e]))
  const incEntries = new Map(i.entries.map((e) => [e.media.id, e]))
  const incEntryTombs = new Map(i.tombstones.entries.map((t) => [t.id, t.deletedAt]))
  const entryTombs = new Map(p.tombstones.entries.map((t) => [t.id, t.deletedAt]))

  const entries: LibraryEntry[] = []
  for (const id of new Set([...prevEntries.keys(), ...incEntries.keys(), ...incEntryTombs.keys()])) {
    const p = prevEntries.get(id)
    const i = incEntries.get(id)
    const liveTs = Math.max(p ? entryTs(p) : 0, i ? entryTs(i) : 0)
    const deadTs = Math.max(incEntryTombs.get(id) ?? 0, entryTombs.get(id) ?? 0)
    if (deadTs > liveTs) {
      entryTombs.set(id, deadTs)
      continue
    }
    const winner = i && (!p || entryTs(i) > entryTs(p)) ? i : p
    if (winner) {
      entries.push(winner)
      entryTombs.delete(id)
    }
  }

  const progressMap = new Map<string, ProgressEntry>()
  for (const row of [...p.progress, ...i.progress]) {
    const existing = progressMap.get(row.mediaId)
    if (existing) {
      progressMap.set(row.mediaId, {
        mediaId: row.mediaId,
        seenEpisodeIds: [...new Set([...existing.seenEpisodeIds, ...row.seenEpisodeIds])],
        updatedAt: Math.max(progressTs(existing), progressTs(row))
      })
    } else progressMap.set(row.mediaId, row)
  }
  const progressTombs = mergeTombstoneLists(p.tombstones.progress, i.tombstones.progress)
  for (const t of progressTombs) {
    const row = progressMap.get(t.id)
    if (row && progressTs(row) <= t.deletedAt) progressMap.delete(t.id)
  }

  const historyMap = new Map<string, HistoryEntry>()
  for (const row of [...p.history, ...i.history]) {
    const existing = historyMap.get(row.episode.id)
    if (!existing || historyTs(row) > historyTs(existing)) historyMap.set(row.episode.id, row)
  }
  const historyTombs = mergeTombstoneLists(p.tombstones.history, i.tombstones.history)
  for (const t of historyTombs) {
    const row = historyMap.get(t.id)
    if (row && historyTs(row) <= t.deletedAt) historyMap.delete(t.id)
  }

  const tombstones: SyncEdits = {
    entries: [...entryTombs].map(([id, deletedAt]) => ({ id, deletedAt })),
    progress: progressTombs.filter((t) => !progressMap.has(t.id)),
    history: historyTombs.filter((t) => !historyMap.has(t.id))
  }

  return { version: 1, entries, progress: [...progressMap.values()], history: [...historyMap.values()], tombstones }
}
