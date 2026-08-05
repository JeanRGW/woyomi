import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { Episode, Media, StreamSource } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import { recordOpen } from '../hooks'
import { BackButton, Banner, Page } from '../components'

export function PlayerView({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  const [streams, setStreams] = useState<StreamSource[]>([])
  const [stream, setStream] = useState<StreamSource | null>(null)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<Media | null>(null)
  const [episode, setEpisode] = useState<Episode | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await runtime.engine.getMedia(sourceId, mediaId)
        const eps = await runtime.engine.getEpisodes(sourceId, mediaId)
        const ep = eps.find((e) => e.id === episodeId) ?? eps[0]
        if (cancelled) return
        setMedia(m)
        setEpisode(ep ?? null)
        if (ep) await recordOpen(runtime, m, ep)
        const ss = await runtime.engine.getStreams(sourceId, m, ep ?? { id: episodeId, number: 1, mediaId })
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
  }, [runtime, sourceId, mediaId, episodeId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    if (stream.kind === 'hls' && Hls.isSupported()) {
      const hls = new Hls()
      hls.loadSource(stream.url)
      hls.attachMedia(video)
      return () => hls.destroy()
    }
    video.src = stream.url
    return () => {
      video.src = ''
    }
  }, [stream])

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
      <h1 className="text-xl font-extrabold tracking-tight md:text-2xl">{media?.title ?? 'Playing…'}</h1>
      {episode && <div className="mt-1 text-sm font-medium text-muted">Episode {episode.number}</div>}
      <video ref={videoRef} controls autoPlay className="mt-4 w-full rounded-2xl bg-black shadow-2xl shadow-black/50 ring-1 ring-white/10" />
      {streams.length > 0 ? (
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
        <p className="mt-4 text-sm text-muted">No playable streams returned.</p>
      )}
    </div>
  )
}
