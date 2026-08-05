import { useCallback, useEffect, useState } from 'react'
import { isVideoType, type HistoryEntry } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import { navigate } from '../App'

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
    <div className="view">
      <h1>History</h1>
      {history.length === 0 ? (
        <p className="muted">Nothing here yet — open a chapter or video and it'll show up.</p>
      ) : (
        <div className="history-list">
          {history.map((h) => (
            <div key={h.episode.id} className="history-row">
              {h.media.coverUrl ? <img className="history-cover" src={h.media.coverUrl} alt="" loading="lazy" /> : <div className="history-cover placeholder">{h.media.type.slice(0, 1).toUpperCase()}</div>}
              <div className="grow">
                <div className="history-title">{h.media.title}</div>
                <div className="muted small">
                  {isVideoType(h.media.type) ? `Episode ${h.episode.number}` : `Chapter ${h.episode.number}`}
                  {h.episode.title ? ` — ${h.episode.title}` : ''}
                </div>
                <div className="muted small">{formatOpened(h.openedAt)}</div>
              </div>
              <button onClick={() => open(h)}>Open</button>
              <button className="danger" onClick={() => remove(h)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatOpened(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString()
}
