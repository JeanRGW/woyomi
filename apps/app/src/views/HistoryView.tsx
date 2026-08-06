import { useCallback, useEffect, useState } from 'react'
import { isVideoType, type HistoryEntry } from '@woyomi/core'
import type { AppRuntime } from '../runtime'
import { navigate } from '../App'
import { EmptyState, Page, PageHeader } from '../components'
import { Icon } from '../icons'

export function HistoryView({ runtime }: { runtime: AppRuntime }) {
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const refresh = useCallback(async () => setHistory(await runtime.store.listHistory()), [runtime])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function remove(entry: HistoryEntry) {
    await runtime.store.removeHistory(entry.episode.id)
    await refresh()
  }

  function open(entry: HistoryEntry) {
    const { sourceId, mediaId } = entry.media
    const episodeId = entry.episode.id
    if (isVideoType(entry.media.type)) navigate({ name: 'player', sourceId, mediaId, episodeId })
    else navigate({ name: 'reader', sourceId, mediaId, episodeId })
  }

  return (
    <Page>
      <PageHeader title="History" />
      {history.length === 0 ? (
        <EmptyState icon="history" title="Nothing watched or read yet" hint="Open a chapter or video and it will land here." />
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <div
              key={h.episode.id}
              className="group flex items-center gap-3 rounded-2xl border border-line-soft bg-surface p-2.5 transition-colors hover:border-accent/50"
            >
              <button onClick={() => open(h)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                {h.media.coverUrl ? (
                  <img className="h-16 w-11 shrink-0 rounded-lg object-cover ring-1 ring-white/5" src={h.media.coverUrl} alt="" loading="lazy" />
                ) : (
                  <div className="grid h-16 w-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-sm font-extrabold uppercase text-muted">
                    {h.media.type.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{h.media.title}</div>
                  <div className="truncate text-xs font-medium text-muted">
                    {isVideoType(h.media.type) ? `Episode ${h.episode.number}` : `Chapter ${h.episode.number}`}
                    {h.episode.title ? ` — ${h.episode.title}` : ''}
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">{formatOpened(h.openedAt)}</div>
                </div>
              </button>
              <button
                onClick={() => open(h)}
                aria-label="Resume"
                className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl bg-accent-soft text-accent transition-colors hover:bg-accent hover:text-white"
              >
                <Icon name={isVideoType(h.media.type) ? 'play' : 'library'} size={16} />
              </button>
              <button
                onClick={() => remove(h)}
                aria-label="Remove from history"
                className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl text-faint transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

function formatOpened(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString()
}
