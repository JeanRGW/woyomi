import { describe, expect, it } from 'vitest'
import type { MediaType } from '@woyomi/core'
import { libraryStatusFilterKey, libraryStatusLabelKey, mediaTypeLabelKey, messages, translate, type MessageKey } from './messages'

describe('translate', () => {
  it('resolves keys from the catalog', () => {
    expect(translate('en', 'status.watching')).toBe('watching')
    expect(translate('en', 'status.completed')).toBe('completed')
  })

  it('interpolates named params', () => {
    expect(translate('en', 'browse.loadMoreFrom', { name: 'Demo Source' })).toBe('Load more from Demo Source')
    expect(translate('en', 'store.update', { version: '2.0.0' })).toBe('Update (2.0.0)')
  })

  it('picks the .one plural form for count 1 and the base form otherwise', () => {
    expect(translate('en', 'media.episodeCount', { count: 1 })).toBe('1 episode')
    expect(translate('en', 'media.episodeCount', { count: 3 })).toBe('3 episodes')
    expect(translate('en', 'media.episodeCount', { count: 0 })).toBe('0 episodes')
    expect(translate('en', 'settings.pluginOptions', { count: 1 })).toBe('Options from 1 plugin')
    expect(translate('en', 'settings.pluginOptions', { count: 2 })).toBe('Options from 2 plugins')
  })
})

describe('libraryStatusLabelKey', () => {
  it.each<MediaType>(['anime', 'movie', 'series'])('maps reading to watching for %s', (type) => {
    expect(libraryStatusLabelKey('reading', type)).toBe('status.watching')
  })

  it.each<MediaType>(['manga', 'novel'])('keeps reading for %s', (type) => {
    expect(libraryStatusLabelKey('reading', type)).toBe('status.reading')
  })

  it('uses watching wording for video plan/paused', () => {
    expect(libraryStatusLabelKey('plan', 'anime')).toBe('status.planToWatch')
    expect(libraryStatusLabelKey('paused', 'anime')).toBe('status.onHold')
  })

  it('keeps reading wording for read plan/paused', () => {
    expect(libraryStatusLabelKey('plan', 'manga')).toBe('status.plan')
    expect(libraryStatusLabelKey('paused', 'manga')).toBe('status.paused')
  })
})

describe('libraryStatusFilterKey', () => {
  it('uses the reading wording for library filter chips', () => {
    expect(libraryStatusFilterKey('reading')).toBe('status.reading')
    expect(libraryStatusFilterKey('plan')).toBe('status.plan')
  })
})

describe('mediaTypeLabelKey', () => {
  it('maps every media type to a catalog key', () => {
    expect(mediaTypeLabelKey('manga')).toBe('type.manga')
    expect(mediaTypeLabelKey('anime')).toBe('type.anime')
    expect(mediaTypeLabelKey('novel')).toBe('type.novel')
    expect(mediaTypeLabelKey('movie')).toBe('type.movie')
    expect(mediaTypeLabelKey('series')).toBe('type.series')
  })
})

describe('pt catalog', () => {
  it('covers every English key', () => {
    for (const key of Object.keys(messages.en) as MessageKey[]) {
      expect(typeof messages.pt[key], `${key} missing in pt`).toBe('string')
    }
  })

  it('resolves pt strings and plurals', () => {
    expect(translate('pt', 'nav.library')).toBe('Biblioteca')
    expect(translate('pt', 'media.chapterCount', { count: 1 })).toBe('1 capítulo')
    expect(translate('pt', 'media.chapterCount', { count: 3 })).toBe('3 capítulos')
    expect(translate('pt', 'status.watching')).toBe('assistindo')
  })

  it('formats numbers per locale', () => {
    expect(translate('pt', 'media.episodeCount', { count: 1000 })).toBe('1.000 episódios')
    expect(translate('en', 'media.episodeCount', { count: 1000 })).toBe('1,000 episodes')
  })
})
