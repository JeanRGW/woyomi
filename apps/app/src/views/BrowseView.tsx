import { useEffect, useState } from 'react'
import type { Media, Source } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import { MediaCard } from '../components'

export function BrowseView({ runtime }: { runtime: AppRuntime }) {
  const [sources, setSources] = useState<Source[]>(runtime.registry.sources())
  const [sourceId, setSourceId] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Media[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const s = runtime.registry.sources()
    setSources(s)
    setSourceId((cur) => cur || s[0]?.id || '')
  }, [runtime])

  async function run(pageNo = 1) {
    if (!query.trim() || !sourceId) return
    setLoading(true)
    setError('')
    try {
      const res = await runtime.engine.search(sourceId, query.trim(), pageNo)
      setResults(pageNo === 1 ? res.items : (prev) => [...prev, ...res.items])
      setHasNext(res.hasNextPage)
      setPage(pageNo)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="view">
      <h1>Browse</h1>
      <div className="row">
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
        <button onClick={() => run()}>Search</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid">
        {results.map((m) => (
          <MediaCard key={m.id} media={m} />
        ))}
      </div>
      {hasNext && (
        <button className="wide" onClick={() => run(page + 1)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
