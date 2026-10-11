// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { navigate, parseHash } from './App'
import { goBackOrLibrary } from './hooks'

describe('parseHash', () => {
  it('maps hashes to routes', () => {
    expect(parseHash('#/library')).toEqual({ name: 'library' })
    expect(parseHash('')).toEqual({ name: 'library' })
    expect(parseHash('#/bogus')).toEqual({ name: 'library' })
    expect(parseHash('#/browse')).toEqual({ name: 'browse' })
    expect(parseHash('#/downloads')).toEqual({ name: 'downloads' })
    expect(parseHash('#/settings')).toEqual({ name: 'settings' })
    expect(parseHash('#/settings/plugins')).toEqual({ name: 'plugin-settings' })
  })

  it('keeps ids with slashes intact', () => {
    expect(parseHash('#/media/src/1/2')).toEqual({ name: 'media', sourceId: 'src', mediaId: '1/2' })
    expect(parseHash('#/reader/src/med/ep/1')).toEqual({ name: 'reader', sourceId: 'src', mediaId: 'med', episodeId: 'ep/1' })
    expect(parseHash('#/player/src/med/ep')).toEqual({ name: 'player', sourceId: 'src', mediaId: 'med', episodeId: 'ep' })
  })
})

describe('goBackOrLibrary', () => {
  it('falls back to the library when there is no in-app history', () => {
    goBackOrLibrary()
    expect(window.location.hash).toBe('#/library')
  })
})

describe('navigate', () => {
  it('pushes the route hash', () => {
    navigate({ name: 'downloads' })
    expect(window.location.hash).toBe('#/downloads')
  })

  it('replaces the hash and dispatches hashchange for the router', () => {
    const seen = vi.fn()
    window.addEventListener('hashchange', seen)
    try {
      navigate({ name: 'library' }, { replace: true })
      expect(window.location.hash).toBe('#/library')
      expect(seen).toHaveBeenCalled()
    } finally {
      window.removeEventListener('hashchange', seen)
    }
  })
})
