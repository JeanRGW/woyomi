import { describe, expect, it } from 'vitest'
import type { PreferencesApi, PreferenceValue } from '@woyomi/core'
import {
  clearPlaybackPosition,
  clearPlayerPosition,
  DEFAULT_PLAYER_PREFS,
  getPlaybackPosition,
  getPlayerPosition,
  loadPlayerPrefs,
  savePlaybackPosition,
  savePlayerPosition,
  validatePlayerPref
} from './player-prefs'

class MockPreferencesApi implements PreferencesApi {
  private map = new Map<string, PreferenceValue>()

  async get<T extends PreferenceValue>(pluginId: string, key: string): Promise<T | undefined> {
    return this.map.get(`${pluginId}:${key}`) as T | undefined
  }

  async getWithDefault<T extends PreferenceValue>(pluginId: string, key: string, fallback: T): Promise<T> {
    const val = this.map.get(`${pluginId}:${key}`)
    return (val !== undefined ? val : fallback) as T
  }

  async set(pluginId: string, key: string, value: PreferenceValue): Promise<void> {
    this.map.set(`${pluginId}:${key}`, value)
  }
}

describe('validatePlayerPref', () => {
  it('validates playbackRate within 0.25 to 4', () => {
    expect(validatePlayerPref('playbackRate', 1.5)).toBe(1.5)
    expect(validatePlayerPref('playbackRate', 0.25)).toBe(0.25)
    expect(validatePlayerPref('playbackRate', 4)).toBe(4)
    expect(validatePlayerPref('playbackRate', 0.1)).toBe(DEFAULT_PLAYER_PREFS.playbackRate)
    expect(validatePlayerPref('playbackRate', 5)).toBe(DEFAULT_PLAYER_PREFS.playbackRate)
    expect(validatePlayerPref('playbackRate', NaN)).toBe(DEFAULT_PLAYER_PREFS.playbackRate)
    expect(validatePlayerPref('playbackRate', '2')).toBe(DEFAULT_PLAYER_PREFS.playbackRate)
  })

  it('validates volume within 0 to 1', () => {
    expect(validatePlayerPref('volume', 0.5)).toBe(0.5)
    expect(validatePlayerPref('volume', 0)).toBe(0)
    expect(validatePlayerPref('volume', 1)).toBe(1)
    expect(validatePlayerPref('volume', -0.1)).toBe(DEFAULT_PLAYER_PREFS.volume)
    expect(validatePlayerPref('volume', 1.5)).toBe(DEFAULT_PLAYER_PREFS.volume)
    expect(validatePlayerPref('volume', NaN)).toBe(DEFAULT_PLAYER_PREFS.volume)
    expect(validatePlayerPref('volume', '1')).toBe(DEFAULT_PLAYER_PREFS.volume)
  })

  it('validates muted boolean', () => {
    expect(validatePlayerPref('muted', true)).toBe(true)
    expect(validatePlayerPref('muted', false)).toBe(false)
    expect(validatePlayerPref('muted', 'true')).toBe(DEFAULT_PLAYER_PREFS.muted)
    expect(validatePlayerPref('muted', 1)).toBe(DEFAULT_PLAYER_PREFS.muted)
    expect(validatePlayerPref('muted', null)).toBe(DEFAULT_PLAYER_PREFS.muted)
  })

  it('validates fit mode', () => {
    expect(validatePlayerPref('fit', 'contain')).toBe('contain')
    expect(validatePlayerPref('fit', 'cover')).toBe('cover')
    expect(validatePlayerPref('fit', 'fill')).toBe('contain')
    expect(validatePlayerPref('fit', 'stretch')).toBe(DEFAULT_PLAYER_PREFS.fit)
    expect(validatePlayerPref('fit', 123)).toBe(DEFAULT_PLAYER_PREFS.fit)
  })

  it('validates autoNext and autoRotate booleans', () => {
    expect(validatePlayerPref('autoNext', true)).toBe(true)
    expect(validatePlayerPref('autoNext', false)).toBe(false)
    expect(validatePlayerPref('autoNext', 'true')).toBe(DEFAULT_PLAYER_PREFS.autoNext)

    expect(validatePlayerPref('autoRotate', false)).toBe(false)
    expect(validatePlayerPref('autoRotate', true)).toBe(true)
    expect(validatePlayerPref('autoRotate', 0)).toBe(DEFAULT_PLAYER_PREFS.autoRotate)
  })

  it('validates preferredQuality and subtitleLanguage strings', () => {
    expect(validatePlayerPref('preferredQuality', '1080p')).toBe('1080p')
    expect(validatePlayerPref('preferredQuality', 1080)).toBe(DEFAULT_PLAYER_PREFS.preferredQuality)
    expect(validatePlayerPref('preferredQuality', 'x'.repeat(161))).toBe(DEFAULT_PLAYER_PREFS.preferredQuality)

    expect(validatePlayerPref('subtitleLanguage', 'en')).toBe('en')
    expect(validatePlayerPref('subtitleLanguage', null)).toBe(DEFAULT_PLAYER_PREFS.subtitleLanguage)
    expect(validatePlayerPref('subtitleLanguage', 'x'.repeat(65))).toBe(DEFAULT_PLAYER_PREFS.subtitleLanguage)
  })
})

describe('loadPlayerPrefs', () => {
  it('returns default preferences when storage is empty', async () => {
    const prefsApi = new MockPreferencesApi()
    const prefs = await loadPlayerPrefs(prefsApi)
    expect(prefs).toEqual(DEFAULT_PLAYER_PREFS)
  })

  it('loads valid custom preferences from storage', async () => {
    const prefsApi = new MockPreferencesApi()
    await prefsApi.set('__app', 'player.playbackRate', 2)
    await prefsApi.set('__app', 'player.volume', 0.8)
    await prefsApi.set('__app', 'player.muted', true)
    await prefsApi.set('__app', 'player.fit', 'cover')
    await prefsApi.set('__app', 'player.autoNext', true)
    await prefsApi.set('__app', 'player.autoRotate', false)
    await prefsApi.set('__app', 'player.preferredQuality', '720p')
    await prefsApi.set('__app', 'player.preferredAudio', 'Legendado')
    await prefsApi.set('__app', 'player.subtitleLanguage', 'pt')

    const loaded = await loadPlayerPrefs(prefsApi)
    expect(loaded).toEqual({
      playbackRate: 2,
      volume: 0.8,
      muted: true,
      fit: 'cover',
      autoNext: true,
      autoRotate: false,
      preferredQuality: '720p',
      preferredAudio: 'Legendado',
      subtitleLanguage: 'pt'
    })
  })

  it('falls back safely when corrupted or invalid values are stored', async () => {
    const prefsApi = new MockPreferencesApi()
    await prefsApi.set('__app', 'player.playbackRate', 99)
    await prefsApi.set('__app', 'player.volume', -5)
    await prefsApi.set('__app', 'player.muted', 'yes')
    await prefsApi.set('__app', 'player.fit', 'invalid_fit')
    await prefsApi.set('__app', 'player.autoNext', 1)
    await prefsApi.set('__app', 'player.autoRotate', null as unknown as PreferenceValue)
    await prefsApi.set('__app', 'player.preferredQuality', 480 as unknown as PreferenceValue)
    await prefsApi.set('__app', 'player.subtitleLanguage', true as unknown as PreferenceValue)

    const loaded = await loadPlayerPrefs(prefsApi)
    expect(loaded).toEqual(DEFAULT_PLAYER_PREFS)
  })
})

describe('playback position helpers', () => {
  it('saves and retrieves position for an episode', async () => {
    const prefsApi = new MockPreferencesApi()
    savePlayerPosition(prefsApi, 'ep-123', 142.5)

    const pos = await getPlayerPosition(prefsApi, 'ep-123')
    expect(pos).toBe(142.5)

    const aliasPos = await getPlaybackPosition(prefsApi, 'ep-123')
    expect(aliasPos).toBe(142.5)
  })

  it('returns undefined for non-existent or invalid saved position', async () => {
    const prefsApi = new MockPreferencesApi()
    expect(await getPlayerPosition(prefsApi, 'unknown')).toBeUndefined()

    await prefsApi.set('__app', 'player.position.invalid-ep', -10)
    expect(await getPlayerPosition(prefsApi, 'invalid-ep')).toBeUndefined()

    await prefsApi.set('__app', 'player.position.string-ep', '120')
    expect(await getPlayerPosition(prefsApi, 'string-ep')).toBeUndefined()
  })

  it('clamps invalid positions to 0 on save', async () => {
    const prefsApi = new MockPreferencesApi()
    savePlayerPosition(prefsApi, 'bad-pos', -50)
    expect(await getPlayerPosition(prefsApi, 'bad-pos')).toBe(0)

    savePlaybackPosition(prefsApi, 'nan-pos', NaN)
    expect(await getPlaybackPosition(prefsApi, 'nan-pos')).toBe(0)
  })

  it('clears position by setting 0', async () => {
    const prefsApi = new MockPreferencesApi()
    savePlayerPosition(prefsApi, 'ep-clear', 500)
    expect(await getPlayerPosition(prefsApi, 'ep-clear')).toBe(500)

    clearPlayerPosition(prefsApi, 'ep-clear')
    expect(await getPlayerPosition(prefsApi, 'ep-clear')).toBe(0)

    savePlaybackPosition(prefsApi, 'ep-clear-alias', 250)
    clearPlaybackPosition(prefsApi, 'ep-clear-alias')
    expect(await getPlaybackPosition(prefsApi, 'ep-clear-alias')).toBe(0)
  })
})
