import { useCallback, useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import { isVideoType, sha256Hex, type Episode, type LibraryEntry, type LibraryStatus } from '@woyomi/core'
import { isTauri, type AppRuntime } from '../runtime'
import type { DownloadRecord } from '../downloads'
import { navigate } from '../App'
import { Icon } from '../icons'
import { useT } from '../i18n'
import { libraryStatusLabelKey, mediaStatusLabelKey, mediaTypeLabelKey } from '../i18n/messages'
import { BackButton, Banner, Btn, CoverArt, EpisodeRow, Page, SelectInput } from '../components'

const STATUSES: LibraryStatus[] = ['reading', 'plan', 'completed', 'dropped', 'paused']

export function MediaView({ runtime, sourceId, mediaId }: { runtime: AppRuntime; sourceId: string; mediaId: string }) {
  const t = useT()
  const [media, setMedia] = useState<Awaited<ReturnType<AppRuntime['engine']['getMedia']>> | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [entry, setEntry] = useState<LibraryEntry | undefined>()
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [downloads, setDownloads] = useState<DownloadRecord[]>([])
  const [qualityEpisode, setQualityEpisode] = useState<Episode>()
  const [qualities, setQualities] = useState<string[]>([])
  const [error, setError] = useState('')
  const [coverOverride, setCoverOverride] = useState<string>()
  const [offlineSnapshot, setOfflineSnapshot] = useState(false)

  const load = useCallback(async () => {
    setMedia(null)
    setError('')
    setCoverOverride(undefined)
    setOfflineSnapshot(false)
    try {
      const [m, eps] = await Promise.all([runtime.engine.getMedia(sourceId, mediaId), runtime.engine.getEpisodes(sourceId, mediaId)])
      setMedia(m)
      setEpisodes(eps)
      setEntry(await runtime.store.get(m.id))
      const prog = await runtime.store.getProgress(m.id)
      setSeen(new Set(prog?.seenEpisodeIds ?? []))
      void cacheMediaPage(runtime, m, eps)
    } catch (e) {
      const cached = await runtime.mediaCache.get(`${sourceId}/${mediaId}`)
      if (cached) {
        setMedia(cached.media)
        setEpisodes(cached.episodes)
        setOfflineSnapshot(true)
        setEntry(await runtime.store.get(cached.media.id))
        const prog = await runtime.store.getProgress(cached.media.id)
        setSeen(new Set(prog?.seenEpisodeIds ?? []))
        if (cached.coverHash && isTauri()) {
          const base = (await window.__TAURI_INTERNALS__!.invoke('stream_proxy_base')) as string
          setCoverOverride(`${base}/covers/${cached.coverHash}`)
        }
        return
      }
      setError(e instanceof Error ? e.message : String(e))
      // getMedia failed (e.g. dead/phantom entry); the library lookup still
      // resolves, so a broken entry keeps its Remove action.
      setEntry(await runtime.store.get(`${sourceId}/${mediaId}`))
    }
  }, [runtime, sourceId, mediaId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const manager = runtime.downloads
    setDownloads([])
    if (!manager) return
    const refresh = async () => setDownloads((await manager.list()).filter((record) => record.media.id === `${sourceId}/${mediaId}`))
    void refresh()
    return manager.subscribe(() => void refresh())
  }, [runtime.downloads, sourceId, mediaId])

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

  async function downloadEpisode(episode: Episode) {
    const manager = runtime.downloads
    if (!manager || !media) return
    setError('')
    try {
      if (!isVideoType(media.type)) {
        await manager.enqueueReader(media, episode)
        return
      }
      const available = await manager.getVideoQualities(media, episode)
      if (available.length === 0) {
        setError(t('downloads.hlsUnsupported'))
        return
      }
      const saved = await runtime.engine.prefs.get<string>('__app', 'downloads.videoQuality')
      setQualities(saved && available.includes(saved) ? [saved, ...available.filter((quality) => quality !== saved)] : available)
      setQualityEpisode(episode)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function chooseQuality(quality: string) {
    if (!runtime.downloads || !media || !qualityEpisode) return
    try {
      await runtime.downloads.enqueueVideo(media, qualityEpisode, quality)
      await runtime.engine.prefs.set('__app', 'downloads.videoQuality', quality)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setQualityEpisode(undefined)
    }
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

  if (error && !media)
    return (
      <Page>
        <BackButton />
        <Banner tone="error">{error}</Banner>
        {entry && (
          <div className="mt-4">
            <Btn
              variant="danger"
              onClick={async () => {
                await runtime.store.remove(entry.media.id)
                navigate({ name: 'library' })
              }}
            >
              {t('media.removeFromLibrary')}
            </Btn>
          </div>
        )}
      </Page>
    )
  if (!media)
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-muted">{t('common.loading')}</p>
      </div>
    )

  const video = isVideoType(media.type)
  const allSeen = episodes.length > 0 && episodes.every((ep) => seen.has(ep.id))
  const displayCoverUrl = coverOverride ?? media.coverUrl

  return (
    <div className="relative min-h-full">
      {displayCoverUrl && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
          <img src={displayCoverUrl} alt="" className="h-full w-full scale-125 object-cover opacity-30 blur-3xl" onError={(e) => (e.currentTarget.hidden = true)} />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/20 via-ink/60 to-ink" />
        </div>
      )}
      <div className="relative mx-auto w-full max-w-4xl px-4 py-5 md:px-8 md:py-8">
        <BackButton />
        <div className="flex gap-4 md:gap-6">
          <div className="w-28 shrink-0 overflow-hidden rounded-2xl shadow-2xl shadow-black/50 ring-1 ring-white/10 sm:w-36 md:w-44">
            <CoverArt media={media} coverUrl={displayCoverUrl} />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-xl font-extrabold leading-tight tracking-tight md:text-3xl">{media.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-accent">{t(mediaTypeLabelKey(media.type))}</span>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted">{media.sourceId}</span>
              {media.status && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted">{t(mediaStatusLabelKey(media.status))}</span>}
            </div>
            {media.tags && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {media.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium text-muted">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SelectInput value={entry?.status ?? ''} onChange={(e) => e.target.value && setStatus(e.target.value as LibraryStatus)}>
                <option value="" disabled>
                  {t('media.addToLibrary')}
                </option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(libraryStatusLabelKey(s, media.type))}
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
                  {t('media.remove')}
                </Btn>
              )}
            </div>
          </div>
        </div>

        {descriptionHtml && <div className="prose-body mt-6" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />}
        {error && <Banner tone="error">{error}</Banner>}
        {offlineSnapshot && <Banner tone="ok">{t('media.offlineSnapshot')}</Banner>}

        <div className="mb-3 mt-8 flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
            {t(video ? 'media.episodeCount' : 'media.chapterCount', { count: episodes.length })}
          </h2>
          <Btn variant="ghost" className="ml-auto min-h-8 px-2.5 text-xs" onClick={allSeen ? markAllUnseen : markAllSeen}>
            {allSeen ? t('media.markAllUnseen') : t('media.markAllSeen')}
          </Btn>
        </div>
        <div className="flex flex-col gap-1.5">
          {episodes.map((ep) => (
            <EpisodeRow
              key={ep.id}
              label={`${ep.number}${ep.season != null ? t('common.season', { season: ep.season }) : ''}${
                ep.title ? t('common.title', { title: ep.title }) : ''
              }`}
              active={seen.has(ep.id)}
              onOpen={() => (video ? navigate({ name: 'player', sourceId, mediaId, episodeId: ep.id }) : navigate({ name: 'reader', sourceId, mediaId, episodeId: ep.id }))}
              onToggleSeen={() => toggleSeen(ep)}
              downloadState={downloads.find((record) => record.id === ep.id)?.state}
              onDownload={runtime.downloads ? () => void downloadEpisode(ep) : undefined}
            />
          ))}
        </div>
      </div>
      {qualityEpisode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="download-quality-title">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 id="download-quality-title" className="text-lg font-bold">
                {t('downloads.chooseQuality')}
              </h2>
              <Btn
                variant="ghost"
                className="size-10 px-0"
                onClick={() => setQualityEpisode(undefined)}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <Icon name="x" size={18} />
              </Btn>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {qualities.map((quality) => (
                <Btn key={quality} variant="soft" onClick={() => void chooseQuality(quality)}>
                  {t('downloads.quality', { quality })}
                </Btn>
              ))}
              <Btn variant="ghost" onClick={() => setQualityEpisode(undefined)}>
                {t('downloads.cancel')}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

async function cacheMediaPage(runtime: AppRuntime, media: NonNullable<Awaited<ReturnType<AppRuntime['engine']['getMedia']>>>, episodes: Episode[]): Promise<void> {
  const coverHash = media.coverUrl ? await sha256Hex(media.coverUrl) : undefined
  await runtime.mediaCache.save(media.id, { media, episodes, coverHash })
  if (media.coverUrl && isTauri()) {
    void window.__TAURI_INTERNALS__!.invoke('cache_cover_image', { args: { url: media.coverUrl } }).catch(() => {})
  }
}
