import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryEntry, LibraryStatus, MediaType } from '@woyomi/core'
import type { AppRuntime } from '../runtime'
import { useT } from '../i18n'
import { libraryStatusFilterKey, mediaTypeLabelKey } from '../i18n/messages'
import {
  Btn,
  Chip,
  EmptyState,
  MediaCard,
  MediaGrid,
  MediaGridSkeleton,
  Page,
  PageHeader,
  SelectInput,
  TextInput
} from '../components'
import { Icon } from '../icons'
import { navigate } from '../App'

const STATUSES: LibraryStatus[] = ['reading', 'plan', 'completed', 'dropped', 'paused']
type SortOption = 'updated' | 'title' | 'status'

export function LibraryView({ runtime }: { runtime: AppRuntime }) {
  const t = useT()
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<LibraryStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('updated')

  const refresh = useCallback(async () => {
    try {
      setEntries(await runtime.store.list())
    } finally {
      setLoading(false)
    }
  }, [runtime])

  useEffect(() => {
    refresh()
  }, [refresh])

  const counts = useMemo(
    () =>
      entries.reduce<Record<string, number>>((acc, e) => {
        acc[e.status] = (acc[e.status] ?? 0) + 1
        return acc
      }, {}),
    [entries]
  )

  const availableTypes = useMemo(() => Array.from(new Set(entries.map((e) => e.media.type))), [entries])

  const filtered = useMemo(() => {
    let list = entries

    if (filter !== 'all') {
      list = list.filter((e) => e.status === filter)
    }

    if (typeFilter !== 'all') {
      list = list.filter((e) => e.media.type === typeFilter)
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((e) => {
        const title = e.media.title.toLowerCase()
        const source = e.media.sourceId.toLowerCase()
        const tags = (e.media.tags ?? []).map((tag) => tag.toLowerCase())
        return title.includes(q) || source.includes(q) || tags.some((tag) => tag.includes(q))
      })
    }

    if (sortBy === 'title') {
      list = [...list].sort((a, b) => a.media.title.localeCompare(b.media.title))
    } else if (sortBy === 'status') {
      list = [...list].sort((a, b) => a.status.localeCompare(b.status))
    }

    return list
  }, [entries, filter, typeFilter, searchQuery, sortBy])

  return (
    <Page wide>
      <PageHeader title={t('nav.library')}>
        {runtime.downloads && (
          <Btn variant="ghost" onClick={() => navigate({ name: 'downloads' })} aria-label={t('downloads.title')} title={t('downloads.title')}>
            <Icon name="download" size={16} />
            <span className="hidden sm:inline">{t('downloads.title')}</span>
          </Btn>
        )}
        <Btn variant="ghost" onClick={refresh} aria-label={t('common.refresh')} title={t('common.refresh')}>
          <Icon name="refresh" size={16} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Btn>
      </PageHeader>

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:-mx-8 md:px-8">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('library.all')} · {entries.length}
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {t(libraryStatusFilterKey(s))} · {counts[s] ?? 0}
          </Chip>
        ))}
      </div>

      {entries.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative min-w-44 flex-1 sm:max-w-xs">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <TextInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('library.searchPlaceholder')}
              className="min-h-9 pl-9 pr-8 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t('common.close')}
                className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-fg"
              >
                <Icon name="clear" size={14} />
              </button>
            )}
          </div>

          {availableTypes.length > 1 && (
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto py-1">
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                className={`min-h-8 cursor-pointer rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                  typeFilter === 'all' ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`}
              >
                {t('library.allTypes')}
              </button>
              {availableTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTypeFilter(type)}
                  className={`min-h-8 cursor-pointer rounded-lg px-2.5 text-xs font-semibold capitalize transition-colors ${
                    typeFilter === type ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  {t(mediaTypeLabelKey(type))}
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-xs font-medium text-muted sm:inline">{t('library.sort')}:</span>
            <SelectInput
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label={t('library.sort')}
              className="min-h-9 px-2.5 text-xs font-semibold"
            >
              <option value="updated">{t('library.sortUpdated')}</option>
              <option value="title">{t('library.sortTitle')}</option>
              <option value="status">{t('library.sortStatus')}</option>
            </SelectInput>
          </div>
        </div>
      )}

      {loading && entries.length === 0 ? (
        <MediaGridSkeleton count={12} />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">
            <Icon name="library" size={22} />
          </div>
          <div className="max-w-sm">
            <p className="font-bold">{t('library.emptyTitle')}</p>
            <p className="mt-1 text-sm text-muted">{t('library.emptyHint')}</p>
          </div>
          <Btn variant="primary" onClick={() => navigate({ name: 'browse' })} className="gap-2">
            <Icon name="browse" size={16} />
            {t('library.browseSources')}
          </Btn>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="search" title={t('library.noMatchesTitle')} hint={t('library.noMatchesHint')} />
      ) : (
        <MediaGrid>
          {filtered.map((e) => (
            <MediaCard key={e.media.id} media={e.media} />
          ))}
        </MediaGrid>
      )}
    </Page>
  )
}
