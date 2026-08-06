import { useEffect, useState } from 'react'
import type { Episode, Media } from '@media-platform/core'
import type { AppRuntime } from './runtime'

/** Reactive matchMedia; false during SSR-less first render until the effect runs. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Record an open: adds to history AND marks the episode seen. */
export async function recordOpen(runtime: AppRuntime, media: Media, episode: Episode): Promise<void> {
  await runtime.store.addHistory(media, episode)
  await runtime.store.setSeen(media.id, episode.id)
}
