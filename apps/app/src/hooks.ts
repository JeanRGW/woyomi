import { useEffect } from 'react'
import type { Episode, Media } from '@media-platform/core'
import type { AppRuntime } from './runtime'

/** Record an open: adds to history AND marks the episode seen. */
export async function recordOpen(runtime: AppRuntime, media: Media, episode: Episode): Promise<void> {
  await runtime.store.addHistory(media, episode)
  await runtime.store.setSeen(media.id, episode.id)
}

/** Fetch media + episode by id, then record the open once. */
export function useRecordOpenById(runtime: AppRuntime, sourceId: string, mediaId: string, episodeId: string): void {
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const media = await runtime.engine.getMedia(sourceId, mediaId)
        const episodes = await runtime.engine.getEpisodes(sourceId, mediaId)
        const episode = episodes.find((e) => e.id === episodeId)
        if (cancelled || !episode) return
        await recordOpen(runtime, media, episode)
      } catch {
        // non-fatal: reading/playing still works if history recording fails
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runtime, sourceId, mediaId, episodeId])
}
