import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeSection, SearchResults, Source } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import type { SourceResults } from '@media-platform/core'
import { MediaCard } from '../components'

/** Runs tasks one at a time; a rejected task never blocks the next. */
type SectionQueue = <T>(task: () => Promise<T>) => Promise<T>

function createQueue(): SectionQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = tail.then(task, task)
    tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}

/** True once the element is near the viewport (fallback: always true). */
function useNearViewport<T extends HTMLElement>(rootMargin = '800px') {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])
  return [ref, near] as const
}

export function BrowseView({ runtime }: { runtime: AppRuntime }) {
  const [mode, setMode] = useState<'home' | 'search'>('home')
  const [sources, setSources] = useState<Source[]>(runtime.registry.sources())

  useEffect(() => {
    setSources(runtime.registry.sources())
  }, [runtime])

  return (
    <div className="view">
      <h1>Browse</h1>
      <div className="row">
        <button className={`nav-btn ${mode === 'home' ? 'active' : ''}`} onClick={() => setMode('home')}>
          Home
        </button>
        <button className={`nav-btn ${mode === 'search' ? 'active' : ''}`} onClick={() => setMode('search')}>
          Search
        </button>
      </div>
      {mode === 'home' ? <HomeTab runtime={runtime} sources={sources} /> : <SearchTab runtime={runtime} sources={sources} />}
    </div>
  )
}

/** Sources that expose a homepage, for the chips row. */
function homeSources(runtime: AppRuntime, sources: Source[]): Source[] {
  return sources.filter((s) => runtime.engine.hasHome(s.id))
}

function HomeTab({ runtime, sources }: { runtime: AppRuntime; sources: Source[] }) {
  const [pinned, setPinned] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const avail = useMemo(() => homeSources(runtime, sources), [runtime, sources])
  const [queue] = useState(createQueue)

  useEffect(() => {
    let cancelled = false
    runtime.getLandingSources().then((ids) => !cancelled && setPinned(ids))
    return () => {
      cancelled = true
    }
  }, [runtime])

  async function togglePin(sourceId: string) {
    const cur = pinned ?? []
    const next = cur.includes(sourceId) ? cur.filter((id) => id !== sourceId) : [...cur, sourceId]
    setPinned(next)
    await runtime.setLandingSources(next)
  }

  if (pinned === null) return <p className="muted">Loading…</p>

  const pinnedSources = avail.filter((s) => pinned.includes(s.id))
  const selectedSource = avail.find((s) => s.id === selected)

  return (
    <div>
      {pinnedSources.length === 0 && !selectedSource && (
        <p className="muted">Your landing is empty — pick a source below and pin it to show its sections here.</p>
      )}
      {pinnedSources.map((s) => (
        <HomeSource key={s.id} runtime={runtime} source={s} pinned onTogglePin={() => togglePin(s.id)} queue={queue} />
      ))}
      {selectedSource && (
        <HomeSource key={selectedSource.id} runtime={runtime} source={selectedSource} pinned={false} onTogglePin={() => togglePin(selectedSource.id)} queue={queue} />
      )}

      <h2>All sources</h2>
      <div className="source-toggles">
        {avail.map((s) => (
          <button
            key={s.id}
            className={`chip-btn ${pinned.includes(s.id) ? 'pinned' : ''} ${selected === s.id ? 'active' : ''}`}
            onClick={() => setSelected(selected === s.id ? null : s.id)}
          >
            {s.name}
            {pinned.includes(s.id) ? ' ★' : ''}
          </button>
        ))}
        {avail.length === 0 && <p className="muted">No sources expose a homepage.</p>}
      </div>
    </div>
  )
}

function HomeSource({
  runtime,
  source,
  pinned,
  onTogglePin,
  queue
}: {
  runtime: AppRuntime
  source: Source
  pinned: boolean
  onTogglePin: () => void
  queue: SectionQueue
}) {
  const [sections, setSections] = useState<HomeSection[]>([])

  useEffect(() => {
    let cancelled = false
    runtime.engine
      .getHomeSections(source.id)
      .then((s) => !cancelled && setSections(s))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [runtime, source.id])

  return (
    <div className="home-source">
      <div className="row">
        <h2>{source.name}</h2>
        <button className="small-btn" onClick={onTogglePin}>
          {pinned ? 'Unpin' : 'Pin'}
        </button>
      </div>
      {sections.map((sec) => (
        <SectionGrid key={sec.id} runtime={runtime} source={source} section={sec} queue={queue} />
      ))}
    </div>
  )
}

function SectionGrid({
  runtime,
  source,
  section,
  queue
}: {
  runtime: AppRuntime
  source: Source
  section: HomeSection
  queue: SectionQueue
}) {
  const [result, setResult] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sentinel, sentinelNear] = useNearViewport<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    if (!sentinelNear || result) return
    setLoading(true)
    setError('')
    queue(() => runtime.engine.getHomeSection(source.id, section.id, 1))
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [runtime, source.id, section.id, sentinelNear, queue, result])

  async function loadMore() {
    const page = (result?.page ?? 1) + 1
    setLoading(true)
    setError('')
    try {
      const r = await queue(() => runtime.engine.getHomeSection(source.id, section.id, page))
      setResult((prev) => (prev ? { ...r, items: [...prev.items, ...r.items] } : r))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h3>{section.title}</h3>
      {error && <div className="error">{error}</div>}
      <div className="grid">{result?.items.map((m) => <MediaCard key={m.id} media={m} />)}</div>
      {result?.hasNextPage && (
        <button className="wide" onClick={loadMore} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      <div ref={sentinel} />
    </div>
  )
}

function SearchTab({ runtime, sources }: { runtime: AppRuntime; sources: Source[] }) {
  const [mode, setMode] = useState<'all' | 'single'>('all')
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [allResults, setAllResults] = useState<SourceResults[]>([])
  const [single, setSingle] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function run(page = 1) {
    const q = query.trim()
    if (!q) return
    if (mode === 'single' && !sourceId) return
    setLoading(true)
    setError('')
    try {
      if (mode === 'all') {
        const res = await runtime.engine.searchAll(q, page)
        setAllResults(page === 1 ? res : (prev) => mergeAll(prev, res))
      } else {
        const res = await runtime.engine.search(sourceId, q, page)
        setSingle(page === 1 ? res : (prev) => (prev ? { ...res, items: [...prev.items, ...res.items] } : res))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="row wrap">
        <button className={`nav-btn ${mode === 'all' ? 'active' : ''}`} onClick={() => setMode('all')}>
          All sources
        </button>
        <button className={`nav-btn ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>
          Single source
        </button>
        {mode === 'single' && (
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="row">
        <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
        <button onClick={() => run()} disabled={loading}>
          Search
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      {mode === 'all' ? (
        allResults.map((r) => (
          <div key={r.sourceId}>
            <h2>
              {r.sourceName}
              {r.error && <span className="muted small"> — {r.error}</span>}
            </h2>
            <div className="grid">{r.items.map((m) => <MediaCard key={m.id} media={m} />)}</div>
            {r.hasNextPage && (
              <button className="wide" onClick={() => run((r.page ?? 1) + 1)} disabled={loading}>
                {loading ? 'Loading…' : `Load more (${r.sourceName})`}
              </button>
            )}
          </div>
        ))
      ) : (
        <>
          <div className="grid">{single?.items.map((m) => <MediaCard key={m.id} media={m} />)}</div>
          {single?.hasNextPage && (
            <button className="wide" onClick={() => run((single.page ?? 1) + 1)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function mergeAll(prev: SourceResults[], next: SourceResults[]): SourceResults[] {
  return next.map((n) => {
    const p = prev.find((x) => x.sourceId === n.sourceId)
    return p ? { ...n, items: [...p.items, ...n.items] } : n
  })
}
