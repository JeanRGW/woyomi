import { describe, expect, it } from 'vitest'
import { MemoryPreferencesApi } from '@woyomi/core'
import { getTextPosition, loadReaderPrefs, restoreTextProgress, saveTextPosition } from './reader-prefs'

const APP_PREFS = '__app'

describe('text reader position', () => {
  it('restores only unfinished normalized progress', () => {
    expect(restoreTextProgress(0.42)).toBe(0.42)
    expect(restoreTextProgress(undefined)).toBe(0)
    expect(restoreTextProgress(Number.NaN)).toBe(0)
    expect(restoreTextProgress(-1)).toBe(0)
    expect(restoreTextProgress(0.99)).toBe(0)
    expect(restoreTextProgress(2)).toBe(0)
  })

  it('uses a text-specific position key', async () => {
    const prefs = new MemoryPreferencesApi()
    saveTextPosition(prefs, 'chapter-1', 0.4)
    expect(await getTextPosition(prefs, 'chapter-1')).toBe(0.4)
    expect(await prefs.get(APP_PREFS, 'reader.position.chapter-1')).toBeUndefined()
  })
})

describe('title reader overrides', () => {
  it('overrides only mode and direction for the selected title', async () => {
    const prefs = new MemoryPreferencesApi()
    await prefs.set(APP_PREFS, 'reader.stripWidth', 60)
    await prefs.set(APP_PREFS, 'reader.mode', 'continuous')
    await prefs.set(APP_PREFS, 'reader.direction', 'rtl')
    await prefs.set(APP_PREFS, 'reader.fit', 'width')
    await prefs.set(APP_PREFS, 'reader.titleOverride.source/title.enabled', true)
    await prefs.set(APP_PREFS, 'reader.titleOverride.source/title.mode', 'paged')
    await prefs.set(APP_PREFS, 'reader.titleOverride.source/title.direction', 'ltr')

    const global = await loadReaderPrefs(prefs)
    const title = await loadReaderPrefs(prefs, 'source/title')
    expect(global.mode).toBe('continuous')
    expect(global.direction).toBe('rtl')
    expect(title.mode).toBe('paged')
    expect(title.direction).toBe('ltr')
    expect(title.fit).toBe('width')
  })
})
