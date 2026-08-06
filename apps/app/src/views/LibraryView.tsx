import { useCallback, useEffect, useState } from 'react'
import type { LibraryEntry, LibraryStatus } from '@woyomi/core'
import type { AppRuntime } from '../runtime'
import { Btn, Chip, EmptyState, MediaCard, MediaGrid, Page, PageHeader } from '../components'
import { Icon } from '../icons'

const STATUSES: LibraryStatus[] = ['reading', 'plan', 'completed', 'dropped', 'paused']

export function LibraryView({ runtime }: { runtime: AppRuntime }) {
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
      <PageHeader title="Library">
        <Btn variant="ghost" onClick={refresh} aria-label="Refresh">
          <Icon name="refresh" size={16} />
          Refresh
        </Btn>
      </PageHeader>
      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:-mx-8 md:px-8">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All · {entries.length}
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {s} · {counts[s] ?? 0}
          </Chip>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="library" title="Nothing here yet" hint="Add titles from Browse and they will show up in your library." />
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
