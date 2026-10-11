import { useEffect, useRef, useState } from 'react'
import type { PreferencesApi } from '@woyomi/core'
import type { ReaderBackground, ReaderFit, ReaderMode, ReadingDirection } from './reader-nav'

export type NovelFontFamily = 'serif' | 'sans'

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
  /** Novel typography */
  fontFamily: NovelFontFamily
  fontSize: number
  lineHeight: number
  columnWidth: number
  paragraphSpacing: number
  /** Keep display awake while reader is active */
  keepAwake: boolean
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  mode: 'continuous',
  direction: 'rtl',
  fit: 'page',
  background: 'ink',
  tapNav: true,
  autoNext: false,
  doublePage: false,
  stripWidth: 100,
  fontFamily: 'serif',
  fontSize: 17,
  lineHeight: 1.8,
  columnWidth: 68,
  paragraphSpacing: 1.1,
  keepAwake: false
}

export const BACKGROUNDS: Record<ReaderBackground, string> = {
  ink: 'var(--color-ink)',
  black: '#050505',
  sepia: 'oklch(0.87 0.03 80)'
}

export const NOVEL_FOREGROUNDS: Record<ReaderBackground, string> = {
  ink: 'oklch(0.88 0.01 320)',
  black: 'oklch(0.88 0.01 320)',
  sepia: 'oklch(0.24 0.03 60)'
}

export const NOVEL_FONT_FAMILIES: Record<NovelFontFamily, string> = {
  serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
  sans: 'var(--font-sans)'
}

/** Reserved plugin id for app-level prefs (same as landing.sources). */
const APP_PREFS = '__app'

interface ReaderPrefLoad {
  prefs: ReaderPrefs
  /** Values before any per-title override; the override toggle restores these. */
  global: ReaderPrefs
  hasTitleOverride: boolean
}

async function loadReaderPrefsWithMeta(prefs: PreferencesApi, titleKey?: string): Promise<ReaderPrefLoad> {
  const global = { ...DEFAULT_READER_PREFS }
  await Promise.all(
    (Object.keys(global) as Array<keyof ReaderPrefs>).map(async (name) => {
      const value = await prefs.get(APP_PREFS, `reader.${name}`)
      if (value !== undefined) Object.assign(global, { [name]: value })
    })
  )
  // device-aware strip-width default: portrait/mobile reads near full-bleed,
  // landscape/desktop gets a centered column
  if ((await prefs.get(APP_PREFS, 'reader.stripWidth')) === undefined) {
    global.stripWidth = window.matchMedia('(orientation: portrait)').matches ? 95 : 40
  }

  const merged = { ...global }
  let hasTitleOverride = false
  if (titleKey) {
    const enabled = await prefs.get<boolean>(APP_PREFS, `reader.titleOverride.${titleKey}.enabled`)
    if (enabled) {
      hasTitleOverride = true
      const overrideMode = await prefs.get<ReaderMode>(APP_PREFS, `reader.titleOverride.${titleKey}.mode`)
      const overrideDirection = await prefs.get<ReadingDirection>(APP_PREFS, `reader.titleOverride.${titleKey}.direction`)
      if (overrideMode !== undefined) merged.mode = overrideMode
      if (overrideDirection !== undefined) merged.direction = overrideDirection
    }
  }
  return { prefs: merged, global, hasTitleOverride }
}

export async function loadReaderPrefs(prefs: PreferencesApi, titleKey?: string): Promise<ReaderPrefs> {
  return (await loadReaderPrefsWithMeta(prefs, titleKey)).prefs
}

export interface UseReaderPrefsReturn {
  prefs: ReaderPrefs
  loaded: boolean
  set: <K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => void
  hasTitleOverride: boolean
  toggleTitleOverride: (enabled?: boolean) => void
}

export function useReaderPrefs(prefs: PreferencesApi, titleKey?: string): UseReaderPrefsReturn {
  const [values, setValues] = useState<ReaderPrefs>(DEFAULT_READER_PREFS)
  const [hasTitleOverride, setHasTitleOverride] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const globalPrefsRef = useRef<Partial<ReaderPrefs>>({})

  useEffect(() => {
    let cancelled = false
    void loadReaderPrefsWithMeta(prefs, titleKey).then(({ prefs: merged, global, hasTitleOverride }) => {
      if (cancelled) return
      globalPrefsRef.current = global
      setValues(merged)
      setHasTitleOverride(hasTitleOverride)
      setLoaded(true)
    })

    return () => {
      cancelled = true
    }
  }, [prefs, titleKey])

  const set = <K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (titleKey && hasTitleOverride && (key === 'mode' || key === 'direction')) {
      void prefs.set(APP_PREFS, `reader.titleOverride.${titleKey}.${key}`, value)
    } else {
      globalPrefsRef.current[key] = value
      void prefs.set(APP_PREFS, `reader.${key}`, value)
    }
  }

  const toggleTitleOverride = (nextEnabled?: boolean) => {
    if (!titleKey) return
    const target = nextEnabled ?? !hasTitleOverride
    setHasTitleOverride(target)
    void prefs.set(APP_PREFS, `reader.titleOverride.${titleKey}.enabled`, target)

    if (target) {
      void prefs.set(APP_PREFS, `reader.titleOverride.${titleKey}.mode`, values.mode)
      void prefs.set(APP_PREFS, `reader.titleOverride.${titleKey}.direction`, values.direction)
    } else {
      setValues((prev) => ({
        ...prev,
        mode: globalPrefsRef.current.mode ?? DEFAULT_READER_PREFS.mode,
        direction: globalPrefsRef.current.direction ?? DEFAULT_READER_PREFS.direction
      }))
    }
  }

  return { prefs: values, loaded, set, hasTitleOverride, toggleTitleOverride }
}

export function getReadPosition(prefs: PreferencesApi, episodeId: string): Promise<number | undefined> {
  return prefs.get<number>(APP_PREFS, `reader.position.${episodeId}`)
}

export function saveReadPosition(prefs: PreferencesApi, episodeId: string, position: number): void {
  void prefs.set(APP_PREFS, `reader.position.${episodeId}`, position)
}

export function getTextPosition(prefs: PreferencesApi, episodeId: string): Promise<number | undefined> {
  return prefs.get<number>(APP_PREFS, `reader.textPosition.${episodeId}`)
}

export function saveTextPosition(prefs: PreferencesApi, episodeId: string, progress: number): void {
  void prefs.set(APP_PREFS, `reader.textPosition.${episodeId}`, progress)
}

export function restoreTextProgress(saved: number | undefined): number {
  if (typeof saved !== 'number' || !Number.isFinite(saved)) return 0
  if (saved <= 0 || saved >= 0.99) return 0
  return Math.min(1, Math.max(0, saved))
}
