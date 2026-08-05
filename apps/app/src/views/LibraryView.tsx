import { useCallback, useEffect, useState } from 'react'
import type { LibraryEntry, LibraryStatus } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import { MediaCard } from '../components'

const STATUSES: LibraryStatus[] = ['reading', 'plan', 'completed', 'dropped', 'paused']

export function LibraryView({ runtime }: { runtime: AppRuntime }) {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [filter, setFilter] = useState<LibraryStatus | 'all'>('all')

  const refresh = useCallback(async () => setEntries(await runtime.store.list()), [runtime])
  useEffect(() => {
    refresh()
  }, [refresh])

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.status === filter)

  return (
    <div className="view">
      <h1>Library</h1>
      <div className="row wrap">
        <select value={filter} onChange={(e) => setFilter(e.target.value as LibraryStatus | 'all')}>
          <option value="all">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button onClick={refresh}>Refresh</button>
      </div>
      {filtered.length === 0 ? (
        <p className="muted">Nothing here yet — add from Browse.</p>
      ) : (
        <div className="grid">
          {filtered.map((e) => (
            <MediaCard key={e.media.id} media={e.media} />
          ))}
        </div>
      )}
    </div>
  )
}
