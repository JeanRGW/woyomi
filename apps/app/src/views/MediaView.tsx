import { useCallback, useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import { isVideoType, type Episode, type LibraryEntry, type LibraryStatus } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import { navigate } from '../App'
import { EpisodeRow } from '../components'

const STATUSES: LibraryStatus[] = ['reading', 'plan', 'completed', 'dropped', 'paused']

export function MediaView({ runtime, sourceId, mediaId }: { runtime: AppRuntime; sourceId: string; mediaId: string }) {
  const [media, setMedia] = useState<Awaited<ReturnType<AppRuntime['engine']['getMedia']>> | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [entry, setEntry] = useState<LibraryEntry | undefined>()
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [m, eps] = await Promise.all([runtime.engine.getMedia(sourceId, mediaId), runtime.engine.getEpisodes(sourceId, mediaId)])
      setMedia(m)
      setEpisodes(eps)
      setEntry(await runtime.store.get(m.id))
      const prog = await runtime.store.getProgress(m.id)
      setSeen(new Set(prog?.seenEpisodeIds ?? []))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [runtime, sourceId, mediaId])

  useEffect(() => {
    load()
  }, [load])

  const descriptionHtml = useMemo(
    () => (media?.synopsis ? marked.parse(media.synopsis, { async: false }) : ''),
    [media?.synopsis]
  )

  async function setStatus(status: LibraryStatus) {
    if (!media) return
    await runtime.store.add(media, status)
    setEntry(await runtime.store.get(media.id))
  }

  async function toggleSeen(ep: Episode) {
    const method = seen.has(ep.id) ? 'unsetSeen' : 'setSeen'
    await runtime.store[method](media!.id, ep.id)
    const prog = await runtime.store.getProgress(media!.id)
    setSeen(new Set(prog?.seenEpisodeIds ?? []))
  }

  async function markAllSeen() {
    await runtime.store.setSeenMany(
      media!.id,
      episodes.map((e) => e.id)
    )
    const prog = await runtime.store.getProgress(media!.id)
    setSeen(new Set(prog?.seenEpisodeIds ?? []))
  }

  async function markAllUnseen() {
    for (const ep of episodes) {
      await runtime.store.unsetSeen(media!.id, ep.id)
    }
    const prog = await runtime.store.getProgress(media!.id)
    setSeen(new Set(prog?.seenEpisodeIds ?? []))
  }

  if (error) return <div className="view"><div className="error">{error}</div></div>
  if (!media) return <div className="view center">Loading…</div>

  const video = isVideoType(media.type)

  return (
    <div className="view">
      <button className="back" onClick={() => history.back()}>← Back</button>
      <div className="media-header">
        {media.coverUrl ? <img className="cover large" src={media.coverUrl} alt="" /> : <div className="cover large placeholder">{media.type.slice(0, 1).toUpperCase()}</div>}
        <div>
          <h1>{media.title}</h1>
          <div className="muted">
            {media.type} · {media.sourceId}
            {media.status ? ` · ${media.status}` : ''}
          </div>
          {descriptionHtml && <div className="description" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />}
          {media.tags && <div className="tags">{media.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
          <div className="row">
            <select value={entry?.status ?? ''} onChange={(e) => e.target.value && setStatus(e.target.value as LibraryStatus)}>
              <option value="" disabled>Add to library…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {entry && <button onClick={async () => { await runtime.store.remove(entry.media.id); setEntry(undefined); }}>Remove</button>}
          </div>
        </div>
      </div>

      <h2>{episodes.length} {video ? 'episodes' : 'chapters'}</h2>
      <div className="episodes">
        {episodes.map((ep) => (
          <EpisodeRow
            key={ep.id}
            label={`${ep.number}${ep.season != null ? ` · S${ep.season}` : ''}${ep.title ? ` — ${ep.title}` : ''}`}
            active={seen.has(ep.id)}
            onOpen={() => (video ? navigate({ name: 'player', sourceId, mediaId, episodeId: ep.id }) : navigate({ name: 'reader', sourceId, mediaId, episodeId: ep.id }))}
            onToggleSeen={() => toggleSeen(ep)}
          />
        ))}
      </div>
      <button className="wide" onClick={episodes.every((ep) => seen.has(ep.id)) ? markAllUnseen : markAllSeen}>
        {episodes.every((ep) => seen.has(ep.id)) ? 'Mark all unseen' : 'Mark all seen'}
      </button>
    </div>
  )
}
