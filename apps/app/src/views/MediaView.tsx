import { useCallback, useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import { isVideoType, type Episode, type LibraryEntry, type LibraryStatus } from '@woyomi/core'
import type { AppRuntime } from '../runtime'
import { navigate } from '../App'
import { BackButton, Banner, Btn, CoverArt, EpisodeRow, Page, SelectInput } from '../components'

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
    await runtime.store.unsetSeenMany(
      media!.id,
      episodes.map((e) => e.id)
    )
    const prog = await runtime.store.getProgress(media!.id)
    setSeen(new Set(prog?.seenEpisodeIds ?? []))
  }

  if (error)
    return (
      <Page>
        <Banner tone="error">{error}</Banner>
      </Page>
    )
  if (!media)
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    )

  const video = isVideoType(media.type)
  const allSeen = episodes.length > 0 && episodes.every((ep) => seen.has(ep.id))

  return (
    <div className="relative min-h-full">
      {media.coverUrl && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
          <img src={media.coverUrl} alt="" className="h-full w-full scale-125 object-cover opacity-30 blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/20 via-ink/60 to-ink" />
        </div>
      )}
      <div className="relative mx-auto w-full max-w-4xl px-4 py-5 md:px-8 md:py-8">
        <BackButton />
        <div className="flex gap-4 md:gap-6">
          <div className="w-28 shrink-0 overflow-hidden rounded-2xl shadow-2xl shadow-black/50 ring-1 ring-white/10 sm:w-36 md:w-44">
            <CoverArt media={media} />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-xl font-extrabold leading-tight tracking-tight md:text-3xl">{media.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-accent">{media.type}</span>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted">{media.sourceId}</span>
              {media.status && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted">{media.status}</span>}
            </div>
            {media.tags && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {media.tags.map((t) => (
                  <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium text-muted">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SelectInput value={entry?.status ?? ''} onChange={(e) => e.target.value && setStatus(e.target.value as LibraryStatus)}>
                <option value="" disabled>
                  Add to library…
                </option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SelectInput>
              {entry && (
                <Btn
                  variant="danger"
                  onClick={async () => {
                    await runtime.store.remove(entry.media.id)
                    setEntry(undefined)
                  }}
                >
                  Remove
                </Btn>
              )}
            </div>
          </div>
        </div>

        {descriptionHtml && <div className="prose-body mt-6" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />}

        <div className="mb-3 mt-8 flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
            {episodes.length} {video ? 'episodes' : 'chapters'}
          </h2>
          <Btn variant="ghost" className="ml-auto min-h-8 px-2.5 text-xs" onClick={allSeen ? markAllUnseen : markAllSeen}>
            {allSeen ? 'Mark all unseen' : 'Mark all seen'}
          </Btn>
        </div>
        <div className="flex flex-col gap-1.5">
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
      </div>
    </div>
  )
}
