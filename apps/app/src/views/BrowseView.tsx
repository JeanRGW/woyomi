import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeSection, SearchResults, Source } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import type { SourceResults } from '@media-platform/core'
import { Banner, Btn, Chip, EmptyState, MediaCard, MediaGrid, Page, PageHeader, SectionHeading, SelectInput, TextInput } from '../components'
import { Icon } from '../icons'

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

function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-8 cursor-pointer rounded-lg px-4 text-[13px] font-bold transition-all ${
            value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function BrowseView({ runtime }: { runtime: AppRuntime }) {
  const [mode, setMode] = useState<'home' | 'search'>('home')
  const [sources, setSources] = useState<Source[]>(runtime.registry.sources())

  useEffect(() => {
    setSources(runtime.registry.sources())
  }, [runtime])

  return (
    <Page wide>
      <PageHeader title="Browse">
        <Segmented options={[{ value: 'home', label: 'Home' }, { value: 'search', label: 'Search' }]} value={mode} onChange={setMode} />
      </PageHeader>
      {mode === 'home' ? <HomeTab runtime={runtime} sources={sources} /> : <SearchTab runtime={runtime} sources={sources} />}
    </Page>
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

  if (pinned === null) return <p className="text-sm text-muted">Loading…</p>

  const pinnedSources = avail.filter((s) => pinned.includes(s.id))
  const selectedSource = avail.find((s) => s.id === selected)

  return (
    <div>
      {pinnedSources.length === 0 && !selectedSource && (
        <EmptyState icon="pin" title="Your home is empty" hint="Pin a source below and its sections will land here." />
      )}
      {pinnedSources.map((s) => (
        <HomeSource key={s.id} runtime={runtime} source={s} pinned onTogglePin={() => togglePin(s.id)} queue={queue} />
      ))}
      {selectedSource && (
        <HomeSource key={selectedSource.id} runtime={runtime} source={selectedSource} pinned={false} onTogglePin={() => togglePin(selectedSource.id)} queue={queue} />
      )}

      <SectionHeading title="All sources" />
      <div className="flex flex-wrap gap-2">
        {avail.map((s) => {
          const isPinned = pinned.includes(s.id)
          return (
            <Chip key={s.id} active={selected === s.id} onClick={() => setSelected(selected === s.id ? null : s.id)}>
              {isPinned && <Icon name="pin" size={13} className="text-accent" />}
              {s.name}
            </Chip>
          )
        })}
        {avail.length === 0 && <p className="text-sm text-muted">No sources expose a homepage.</p>}
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
    <div className="mb-2">
      <div className="mb-1 mt-6 flex items-center gap-3">
        <h2 className="text-lg font-extrabold tracking-tight">{source.name}</h2>
        <Btn variant="ghost" className="min-h-8 px-2.5 text-xs" onClick={onTogglePin}>
          <Icon name="pin" size={13} className={pinned ? 'text-accent' : ''} />
          {pinned ? 'Unpin' : 'Pin'}
        </Btn>
      </div>
      {sections.map((sec) => (
        <SectionRail key={sec.id} runtime={runtime} source={source} section={sec} queue={queue} />
      ))}
    </div>
  )
}

function SectionRail({
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
    <div className="rise-in">
      <h3 className="mb-2 mt-4 text-sm font-bold text-muted">{section.title}</h3>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="rail no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:-mx-8 md:px-8">
        {result
          ? result.items.map((m) => <MediaCard key={m.id} media={m} className="w-[7.5rem] shrink-0 sm:w-32 md:w-36" />)
          : !error &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-[7.5rem] shrink-0 sm:w-32 md:w-36">
                <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-surface-2" />
                <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-surface-2" />
              </div>
            ))}
        {result?.hasNextPage && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="grid w-[7.5rem] shrink-0 cursor-pointer place-items-center self-start rounded-xl bg-surface-2 text-muted transition-colors hover:bg-surface-3 hover:text-accent disabled:opacity-40 sm:w-32 md:w-36"
            style={{ aspectRatio: '2/3' }}
          >
            <span className="flex flex-col items-center gap-1 text-xs font-bold">
              <Icon name="chevronRight" size={20} />
              {loading ? 'Loading…' : 'More'}
            </span>
          </button>
        )}
      </div>
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

  const hasResults = mode === 'all' ? allResults.length > 0 : (single?.items.length ?? 0) > 0

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          options={[{ value: 'all', label: 'All sources' }, { value: 'single', label: 'Single source' }]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'single' && (
          <SelectInput value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <TextInput
            className="pl-10"
            placeholder="Search titles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
        </div>
        <Btn variant="primary" onClick={() => run()} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Btn>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {!hasResults && !loading && !error && (
        <div className="mt-6">
          <EmptyState icon="search" title="Search every source at once" hint="Results are grouped per source. Pick a single source for paged results." />
        </div>
      )}

      {mode === 'all' ? (
        allResults.map((r) => (
          <div key={r.sourceId}>
            <SectionHeading
              title={r.sourceName}
              action={r.error ? <span className="text-xs font-normal normal-case text-danger">{r.error}</span> : undefined}
            />
            <MediaGrid>{r.items.map((m) => <MediaCard key={m.id} media={m} />)}</MediaGrid>
            {r.hasNextPage && (
              <Btn variant="outline" className="mt-4 w-full" onClick={() => run((r.page ?? 1) + 1)} disabled={loading}>
                {loading ? 'Loading…' : `Load more from ${r.sourceName}`}
              </Btn>
            )}
          </div>
        ))
      ) : (
        <>
          <div className="mt-5">
            <MediaGrid>{single?.items.map((m) => <MediaCard key={m.id} media={m} />)}</MediaGrid>
          </div>
          {single?.hasNextPage && (
            <Btn variant="outline" className="mt-4 w-full" onClick={() => run((single.page ?? 1) + 1)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </Btn>
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
