import { useEffect, useState } from 'react'
import type { PreferencesApi } from '@woyomi/core'

export type PlayerFit = 'contain' | 'cover'

export interface PlayerPrefs {
  playbackRate: number
  volume: number
  muted: boolean
  fit: PlayerFit
  autoNext: boolean
  autoRotate: boolean
  /** Level label chosen in the quality menu (`''` = auto); audio never lands here. */
  preferredQuality: string
  /** Audio label chosen among per-audio streams (`''` = plugin order). */
  preferredAudio: string
  subtitleLanguage: string
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  playbackRate: 1,
  volume: 1,
  muted: false,
  fit: 'contain',
  autoNext: false,
  autoRotate: true,
  preferredQuality: '',
  preferredAudio: '',
  subtitleLanguage: ''
}

/** Reserved plugin id for app-level prefs (same as landing.sources / reader). */
const APP_PREFS = '__app'

export function validatePlayerPref<K extends keyof PlayerPrefs>(key: K, value: unknown): PlayerPrefs[K] {
  switch (key) {
    case 'playbackRate':
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0.25 && value <= 4) {
        return value as PlayerPrefs[K]
      }
      return DEFAULT_PLAYER_PREFS.playbackRate as PlayerPrefs[K]
    case 'volume':
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
        return value as PlayerPrefs[K]
      }
      return DEFAULT_PLAYER_PREFS.volume as PlayerPrefs[K]
    case 'muted':
      return (typeof value === 'boolean' ? value : DEFAULT_PLAYER_PREFS.muted) as PlayerPrefs[K]
    case 'fit':
      if (value === 'contain' || value === 'cover') {
        return value as PlayerPrefs[K]
      }
      return DEFAULT_PLAYER_PREFS.fit as PlayerPrefs[K]
    case 'autoNext':
      return (typeof value === 'boolean' ? value : DEFAULT_PLAYER_PREFS.autoNext) as PlayerPrefs[K]
    case 'autoRotate':
      return (typeof value === 'boolean' ? value : DEFAULT_PLAYER_PREFS.autoRotate) as PlayerPrefs[K]
    case 'preferredQuality':
      return (typeof value === 'string' && value.length <= 160 ? value : DEFAULT_PLAYER_PREFS.preferredQuality) as PlayerPrefs[K]
    case 'preferredAudio':
      return (typeof value === 'string' && value.length <= 160 ? value : DEFAULT_PLAYER_PREFS.preferredAudio) as PlayerPrefs[K]
    case 'subtitleLanguage':
      return (typeof value === 'string' && value.length <= 64 ? value : DEFAULT_PLAYER_PREFS.subtitleLanguage) as PlayerPrefs[K]
    default:
      return DEFAULT_PLAYER_PREFS[key]
  }
}

export async function loadPlayerPrefs(prefs: PreferencesApi): Promise<PlayerPrefs> {
  const out = { ...DEFAULT_PLAYER_PREFS }
  await Promise.all(
    (Object.keys(out) as Array<keyof PlayerPrefs>).map(async (name) => {
      const value = await prefs.get(APP_PREFS, `player.${name}`)
      if (value !== undefined) {
        out[name] = validatePlayerPref(name, value) as never
      }
    })
  )
  return out
}

export function usePlayerPrefs(prefs: PreferencesApi): {
  prefs: PlayerPrefs
  loaded: boolean
  set: <K extends keyof PlayerPrefs>(key: K, value: PlayerPrefs[K]) => void
} {
  const [values, setValues] = useState<PlayerPrefs>(DEFAULT_PLAYER_PREFS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadPlayerPrefs(prefs).then((p) => {
      if (cancelled) return
      setValues(p)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [prefs])

  const set = <K extends keyof PlayerPrefs>(key: K, value: PlayerPrefs[K]) => {
    const validated = validatePlayerPref(key, value)
    setValues((prev) => ({ ...prev, [key]: validated }))
    void prefs.set(APP_PREFS, `player.${key}`, validated)
  }

  return { prefs: values, loaded, set }
}

export async function getPlayerPosition(prefs: PreferencesApi, episodeId: string): Promise<number | undefined> {
  const val = await prefs.get<number>(APP_PREFS, `player.position.${episodeId}`)
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    return val
  }
  return undefined
}

export function savePlayerPosition(prefs: PreferencesApi, episodeId: string, position: number): void {
  const safePos = Number.isFinite(position) && position >= 0 ? position : 0
  void prefs.set(APP_PREFS, `player.position.${episodeId}`, safePos)
}

export function clearPlayerPosition(prefs: PreferencesApi, episodeId: string): void {
  void prefs.set(APP_PREFS, `player.position.${episodeId}`, 0)
}

export const getPlaybackPosition = getPlayerPosition
export const savePlaybackPosition = savePlayerPosition
export const clearPlaybackPosition = clearPlayerPosition
