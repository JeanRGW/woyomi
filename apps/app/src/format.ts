import type { Episode } from '@woyomi/core'
import type { T } from './i18n'

/** Canonical episode/chapter label: "Chapter 3 · S1 — Title". */
export function formatEpisodeLabel(t: T, episode: Episode, kind: 'episode' | 'chapter'): string {
  return `${t(kind === 'episode' ? 'common.episode' : 'common.chapter', { number: episode.number })}${
    episode.season != null ? t('common.season', { season: episode.season }) : ''
  }${episode.title ? t('common.title', { title: episode.title }) : ''}`
}
