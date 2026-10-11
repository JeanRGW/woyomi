import { useEffect, useState } from 'react'
import type { Episode, Media } from '@woyomi/core'
import { navigate } from './App'
import type { AppRuntime } from './runtime'

/** History back with a library fallback when there is no in-app history. */
export function goBackOrLibrary(): void {
  if (window.history.length > 1) window.history.back()
  else navigate({ name: 'library' })
}

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
