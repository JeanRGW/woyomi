import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { Episode, Media, StreamSource } from '@media-platform/core'
import type { AppRuntime } from '../runtime'

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

  if (error) return <div className="view"><div className="error">{error}</div></div>

  return (
    <div className="view">
      <button className="back" onClick={() => history.back()}>← Back</button>
      <h1>{media?.title ?? 'Playing…'}</h1>
      <div className="muted">{episode ? `Episode ${episode.number}` : ''}</div>
      <video ref={videoRef} controls autoPlay className="player" />
      {streams.length > 0 ? (
        <div className="row">
          {streams.map((s, i) => (
            <button key={i} className={stream?.url === s.url ? 'active' : ''} onClick={() => setStream(s)}>
              {s.quality ?? s.kind}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">No playable streams returned.</p>
      )}
    </div>
  )
}
