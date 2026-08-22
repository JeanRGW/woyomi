import { useCallback, useEffect, useState } from 'react'
import type { LibraryEntry, LibraryStatus } from '@woyomi/core'
import type { AppRuntime } from '../runtime'
import { useT } from '../i18n'
import { libraryStatusFilterKey } from '../i18n/messages'
import { Btn, Chip, EmptyState, MediaCard, MediaGrid, Page, PageHeader } from '../components'
import { Icon } from '../icons'
import { navigate } from '../App'

const STATUSES: LibraryStatus[] = ['reading', 'plan', 'completed', 'dropped', 'paused']

export function LibraryView({ runtime }: { runtime: AppRuntime }) {
  const t = useT()
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [filter, setFilter] = useState<LibraryStatus | 'all'>('all')

  const refresh = useCallback(async () => setEntries(await runtime.store.list()), [runtime])
  useEffect(() => {
    refresh()
  }, [refresh])

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.status === filter)
  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1
    return acc
  }, {})

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
      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:-mx-8 md:px-8">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('library.all')} · {entries.length}
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {t(libraryStatusFilterKey(s))} · {counts[s] ?? 0}
          </Chip>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="library" title={t('library.emptyTitle')} hint={t('library.emptyHint')} />
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
