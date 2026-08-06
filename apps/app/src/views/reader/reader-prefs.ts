import { useEffect, useState } from 'react'
import type { PreferencesApi } from '@media-platform/core'
import type { ReaderBackground, ReaderFit, ReaderMode, ReadingDirection } from './reader-nav'

export interface ReaderPrefs {
  mode: ReaderMode
  direction: ReadingDirection
  fit: ReaderFit
  background: ReaderBackground
  tapNav: boolean
  autoNext: boolean
  doublePage: boolean
  /** strip column width as % of screen width (30–100); mixed-width webtoon pages all fit it */
  stripWidth: number
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  mode: 'continuous',
  direction: 'rtl',
  fit: 'page',
  background: 'ink',
  tapNav: true,
  autoNext: false,
  doublePage: false,
  stripWidth: 100
}

export const BACKGROUNDS: Record<ReaderBackground, string> = {
  ink: 'var(--color-ink)',
  black: '#050505',
  sepia: 'oklch(0.87 0.03 80)'
}

/** Reserved plugin id for app-level prefs (same as landing.sources). */
const APP_PREFS = '__app'

export async function loadReaderPrefs(prefs: PreferencesApi): Promise<ReaderPrefs> {
  const out = { ...DEFAULT_READER_PREFS }
  await Promise.all(
    (Object.keys(out) as Array<keyof ReaderPrefs>).map(async (name) => {
      const value = await prefs.get(APP_PREFS, `reader.${name}`)
      if (value !== undefined) Object.assign(out, { [name]: value })
    })
  )
  // device-aware strip-width default: portrait/mobile reads near full-bleed,
  // landscape/desktop gets a centered column
  if ((await prefs.get(APP_PREFS, 'reader.stripWidth')) === undefined) {
    out.stripWidth = window.matchMedia('(orientation: portrait)').matches ? 95 : 40
  }
  return out
}

export function useReaderPrefs(prefs: PreferencesApi): { prefs: ReaderPrefs; loaded: boolean; set: <K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => void } {
  const [values, setValues] = useState<ReaderPrefs>(DEFAULT_READER_PREFS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadReaderPrefs(prefs).then((p) => {
      if (cancelled) return
      setValues(p)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [prefs])

  const set = <K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    void prefs.set(APP_PREFS, `reader.${key}`, value)
  }

  return { prefs: values, loaded, set }
}

export function getReadPosition(prefs: PreferencesApi, episodeId: string): Promise<number | undefined> {
  return prefs.get<number>(APP_PREFS, `reader.position.${episodeId}`)
}

export function saveReadPosition(prefs: PreferencesApi, episodeId: string, position: number): void {
  void prefs.set(APP_PREFS, `reader.position.${episodeId}`, position)
}
