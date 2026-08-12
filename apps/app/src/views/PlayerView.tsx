import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { Episode, Media, StreamSource } from '@woyomi/core'
import { playableStreamUrl, type AppRuntime } from '../runtime'
import { recordOpen } from '../hooks'
import { useT } from '../i18n'
import { BackButton, Banner, Page } from '../components'

export function PlayerView({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  const t = useT()
  const [streams, setStreams] = useState<StreamSource[]>([])
  const [stream, setStream] = useState<StreamSource | null>(null)
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<Media | null>(null)
  const [episode, setEpisode] = useState<Episode | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const local = await runtime.downloads?.localVideo(episodeId)
        if (cancelled) return
        if (local) {
          setMedia(local.record.media)
          setEpisode(local.record.episode)
          setLocalUrl(local.url)
          await recordOpen(runtime, local.record.media, local.record.episode)
          return
        }

        const m = await runtime.engine.getMedia(sourceId, mediaId)
        const eps = await runtime.engine.getEpisodes(sourceId, mediaId)
        const ep = eps.find((e) => e.id === episodeId)
        if (cancelled) return
        if (!ep) {
          setError(t('player.episodeNotFound'))
          return
        }
        setMedia(m)
        setEpisode(ep)
        await recordOpen(runtime, m, ep)
        const ss = await runtime.engine.getStreams(sourceId, m, ep)
        if (cancelled) return
        setStreams(ss)
        setStream(ss[0] ?? null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runtime, sourceId, mediaId, episodeId, t])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement || (!stream && !localUrl)) return
    const video = videoElement
    let hls: Hls | undefined
    let cancelled = false
    async function load(): Promise<void> {
      if (localUrl) {
        video.src = localUrl
        return
      }
      if (!stream) return
      const url = await playableStreamUrl(stream)
      if (cancelled) return
      if (stream.kind === 'hls' && Hls.isSupported()) {
        hls = new Hls()
        hls.loadSource(url)
        hls.attachMedia(video)
      } else {
        video.src = url
      }
    }
    void load().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
      hls?.destroy()
      video.src = ''
    }
  }, [stream, localUrl])

  if (error)
    return (
      <Page>
        <BackButton />
        <Banner tone="error">{error}</Banner>
      </Page>
    )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 md:py-8">
      <BackButton />
      <h1 className="text-xl font-extrabold tracking-tight md:text-2xl">{media?.title ?? t('player.playing')}</h1>
      {episode && <div className="mt-1 text-sm font-medium text-muted">{t('common.episode', { number: episode.number })}</div>}
      <video ref={videoRef} controls autoPlay className="mt-4 w-full rounded-2xl bg-black shadow-2xl shadow-black/50 ring-1 ring-white/10" />
      {!localUrl &&
        (streams.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {streams.map((s, i) => (
              <button
                key={i}
                onClick={() => setStream(s)}
                className={`min-h-9 cursor-pointer rounded-full px-4 text-[13px] font-bold transition-all active:scale-[0.96] ${
                  stream?.url === s.url ? 'bg-accent text-white shadow-sm shadow-accent/25' : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg'
                }`}
              >
                {s.quality ?? s.kind}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">{t('player.noStreams')}</p>
        ))}
    </div>
  )
}
