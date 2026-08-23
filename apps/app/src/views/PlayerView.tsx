import { useEffect, useRef, useState } from 'react'
import type { Episode, Media, StreamSource } from '@woyomi/core'
import { navigate } from '../App'
import { recordOpen } from '../hooks'
import { useT } from '../i18n'
import { type AppRuntime } from '../runtime'
import { findAdjacent } from './reader/reader-nav'
import { loadPlayerPrefs } from './player/player-prefs'
import { enterAndroidPlayerMode, exitAndroidPlayerMode } from './player/player-platform'
import { VideoPlayer } from './player/VideoPlayer'

interface PlayerSessionData {
  media: Media
  episode: Episode
  episodes: Episode[]
  streams: StreamSource[]
  localUrl?: string
  downloadedEpisodeIds: Set<string>
}

export function PlayerView({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  useEffect(() => {
    let cancelled = false
    void loadPlayerPrefs(runtime.engine.prefs)
      .then((prefs) => {
        if (!cancelled) enterAndroidPlayerMode(prefs.autoRotate)
      })
      .catch((prefsError: unknown) => {
        console.warn('failed to load player preferences:', prefsError)
        if (!cancelled) enterAndroidPlayerMode(true)
      })
    return () => {
      cancelled = true
      exitAndroidPlayerMode()
    }
  }, [runtime.engine.prefs])

  return <PlayerSession key={episodeId} runtime={runtime} sourceId={sourceId} mediaId={mediaId} episodeId={episodeId} />
}

function PlayerSession({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  const t = useT()
  const translateRef = useRef(t)
  translateRef.current = t
  const [session, setSession] = useState<PlayerSessionData>()
  const [error, setError] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setSession(undefined)
      setError('')

      try {
        const fullMediaId = `${sourceId}/${mediaId}`
        const local = await runtime.downloads?.localVideo(episodeId).catch(() => undefined)
        if (cancelled) return

        if (local) {
          const cached = await runtime.mediaCache.get(fullMediaId).catch(() => undefined)
          const completeDownloads = await runtime.downloads?.listCompleteForMedia(local.record.media.id).catch(() => [])
          const videoDownloads = (completeDownloads ?? []).filter((record) => record.kind === 'mp4')
          const episodes = mergeOfflineEpisodes(cached?.episodes ?? [local.record.episode], videoDownloads.map((record) => record.episode))
          const downloadedEpisodeIds = new Set(
            videoDownloads.map((record) => record.episode.id)
          )
          if (cancelled) return
          const media = cached?.media ?? local.record.media
          setSession({
            media,
            episode: local.record.episode,
            episodes,
            streams: [],
            localUrl: local.url,
            downloadedEpisodeIds
          })
          try {
            await recordOpen(runtime, media, local.record.episode)
          } catch (recordError) {
            console.warn('failed to record video open:', recordError)
          }
          return
        }

        const [mediaResult, episodesResult] = await Promise.allSettled([
            runtime.engine.getMedia(sourceId, mediaId),
            runtime.engine.getEpisodes(sourceId, mediaId)
        ])
        const cached = mediaResult.status === 'rejected' || episodesResult.status === 'rejected'
          ? await runtime.mediaCache.get(fullMediaId).catch(() => undefined)
          : undefined

        const media: Media | undefined = mediaResult.status === 'fulfilled' ? mediaResult.value : cached?.media
        let episodes: Episode[] = episodesResult.status === 'fulfilled' ? episodesResult.value : cached?.episodes ?? []
        const episode: Episode | undefined = episodes.find((item) => item.id === episodeId)

        if (mediaResult.status === 'fulfilled' && episodesResult.status === 'fulfilled') {
          void runtime.cacheMediaPage(mediaResult.value, episodesResult.value)
        }

        if (!media || !episode) {
          if (mediaResult.status === 'rejected') console.warn('failed to load video metadata:', mediaResult.reason)
          if (episodesResult.status === 'rejected') console.warn('failed to load video episodes:', episodesResult.reason)
          const metadataFailed = mediaResult.status === 'rejected' || episodesResult.status === 'rejected'
          setError(translateRef.current(metadataFailed ? 'player.metadataLoadFailed' : 'player.episodeNotFound'))
          return
        }

        if (episodes.length === 0) episodes = [episode]

        const completeDownloads = (await runtime.downloads?.listCompleteForMedia(media.id).catch(() => [])) ?? []
        const downloadedEpisodeIds = new Set(
          completeDownloads.filter((record) => record.kind === 'mp4').map((record) => record.episode.id)
        )

        let streams: StreamSource[] = []
        try {
          streams = await runtime.engine.getStreams(sourceId, media, episode)
        } catch (streamError) {
          console.warn('failed to load video streams:', streamError)
        }
        if (cancelled) return

        setSession({
          media,
          episode,
          episodes,
          streams,
          downloadedEpisodeIds
        })

        try {
          await recordOpen(runtime, media, episode)
        } catch (recordError) {
          console.warn('failed to record video open:', recordError)
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [runtime, sourceId, mediaId, episodeId, loadRevision])

  const goBack = () => (window.history.length > 1 ? window.history.back() : navigate({ name: 'library' }))

  if (error) {
    return (
      <div className="fixed inset-0 z-50 grid bg-black px-5 text-fg">
        <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
          <p className="text-sm font-semibold text-danger">{error}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setLoadRevision((revision) => revision + 1)} className="min-h-11 rounded-xl bg-accent px-5 text-sm font-bold text-white">
              {t('player.retry')}
            </button>
            <button type="button" onClick={goBack} className="min-h-11 rounded-xl bg-surface-2 px-5 text-sm font-bold hover:bg-surface-3">
              {t('common.back')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="fixed inset-0 z-50 grid bg-black text-fg" role="status">
        <div className="m-auto flex flex-col items-center gap-3">
          <span className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
          <p className="text-sm font-semibold text-muted">{t('player.loading')}</p>
        </div>
      </div>
    )
  }

  const previousEpisode = findAdjacent(session.episodes, episodeId, -1)
  const nextEpisode = findAdjacent(session.episodes, episodeId, 1)
  const openEpisode = (next: Episode) => navigate({ name: 'player', sourceId, mediaId, episodeId: next.id }, { replace: true })
  const reloadStreams = async () => {
    const streams = await runtime.engine.getStreams(sourceId, session.media, session.episode)
    setSession((current) => current ? { ...current, streams } : current)
  }

  return (
    <VideoPlayer
      runtime={runtime}
      media={session.media}
      episode={session.episode}
      episodes={session.episodes}
      streams={session.streams}
      localUrl={session.localUrl}
      downloadedEpisodeIds={session.downloadedEpisodeIds}
      previousEpisode={previousEpisode}
      nextEpisode={nextEpisode}
      onOpenEpisode={openEpisode}
      onReloadStreams={reloadStreams}
      onBack={goBack}
    />
  )
}

function mergeOfflineEpisodes(cached: Episode[], downloaded: Episode[]): Episode[] {
  const merged = [...cached]
  for (const episode of downloaded) {
    if (!merged.some((item) => item.id === episode.id)) merged.push(episode)
  }
  if (cached.length <= 1) {
    merged.sort((left, right) => (left.season ?? 0) - (right.season ?? 0) || left.number - right.number)
  }
  return merged
}
