import type {
  ChapterContent,
  CacheApi,
  Episode,
  FetchFn,
  FetchInit,
  FetchResult,
  HomeSection,
  Media,
  PreferencesApi,
  PreferenceValue,
  SearchResults,
  Source,
  SourcePrefs,
  StreamSource
} from './types.js'
import { TTLCache } from './cache.js'

export interface EngineOptions {
  fetch: FetchFn
  cache?: CacheApi
  /** minimum gap between fetches to the same source (anti-ban). default 300ms */
  sourceThrottleMs?: number
  /** optional preferences backend keyed by plugin id; absent sources use a no-op */
  sourcePrefs?: PreferencesApi
  /** which sources searchAll may query; defaults to all registered sources */
  canSearch?: (sourceId: string) => boolean
}

/** Per-source slice of a multi-source search; a failing source sets `error` only. */
export interface SourceResults {
  sourceId: string
  sourceName: string
  page: number
  hasNextPage: boolean
  items: Media[]
  error?: string
}

/**
 * Throttles calls to an underlying fetch: guarantees a min interval between
 * successive calls per source, and dedupes in-flight concurrent calls.
 * ponytail: naive fixed-rate limiter. Per-source token bucket if a source
 * publishes a real rate limit.
 */
export class ThrottledFetch {
  private lastCall = 0
  private inflight: Map<string, Promise<FetchResult>> = new Map()

  constructor(
    private inner: FetchFn,
    private minIntervalMs: number
  ) {}

  async call(key: string, url: string, init?: FetchInit): Promise<FetchResult> {
    const cacheKey = `${key}\u0000${url}\u0000${JSON.stringify(init ?? {})}`
    const existing = this.inflight.get(cacheKey)
    if (existing) return existing

    const promise = (async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastCall)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      this.lastCall = Date.now()
      return this.inner(url, init)
    })().finally(() => this.inflight.delete(cacheKey))

    this.inflight.set(cacheKey, promise)
    return promise
  }
}

export class Engine {
  private sources = new Map<string, Source>()
  private sourcePlugins = new Map<string, string>()
  readonly cache: CacheApi
  readonly prefs: PreferencesApi
  private throttles = new Map<string, ThrottledFetch>()

  constructor(private opts: EngineOptions) {
    this.cache = opts.cache ?? new TTLCache()
    this.prefs = opts.sourcePrefs ?? noopPrefs
  }

  /** Registers a source, optionally under a plugin id (defaults to the source id). */
  registerSource(source: Source, pluginId?: string): void {
    this.sources.set(source.id, source)
    this.sourcePlugins.set(source.id, pluginId ?? source.id)
  }

  getSource(id: string): Source | undefined {
    return this.sources.get(id)
  }

  listSources(): Source[] {
    return [...this.sources.values()]
  }

  /** Removes every source registered under `pluginId` and its throttle state. */
  unregisterPlugin(pluginId: string): void {
    for (const [id, pid] of [...this.sourcePlugins]) {
      if (pid === pluginId) {
        this.sources.delete(id)
        this.sourcePlugins.delete(id)
        this.throttles.delete(id)
      }
    }
  }

  private ctxFor(sourceId: string) {
    const throttle = this.throttles.get(sourceId) ?? new ThrottledFetch(this.opts.fetch, this.opts.sourceThrottleMs ?? 300)
    this.throttles.set(sourceId, throttle)
    const fetch: FetchFn = (url, init) => throttle.call(sourceId, url, init)
    const pluginId = this.sourcePlugins.get(sourceId) ?? sourceId
    return { fetch, cache: this.cache, preferences: bindPrefs(this.prefs, pluginId) }
  }

  /**
   * Throttled, timeout-capped fetch for a registered source, for sandboxed
   * plugins whose worker routes ctx.fetch back to the main thread.
   */
  getSourceFetch(sourceId: string): FetchFn {
    this.require(sourceId)
    const throttle = this.throttles.get(sourceId) ?? new ThrottledFetch(this.opts.fetch, this.opts.sourceThrottleMs ?? 300)
    this.throttles.set(sourceId, throttle)
    return (url, init) => throttle.call(sourceId, url, init)
  }

  async search(sourceId: string, query: string, page: number): Promise<SearchResults> {
    const source = this.require(sourceId)
    return source.search(this.ctxFor(sourceId), query, page)
  }

  /**
   * Searches every searchable source in parallel, split per source. `onSource`
   * is called once per source, in settlement order; a source that throws is
   * delivered as a result with `error` set and never blocks the others. The
   * promise resolves when every source has settled.
   */
  async searchAll(query: string, page: number, onSource: (r: SourceResults) => void): Promise<void> {
    const sources = [...this.sources.values()].filter((s) => this.opts.canSearch?.(s.id) ?? true)
    await Promise.all(
      sources.map(async (s) => {
        try {
          const r = await s.search(this.ctxFor(s.id), query, page)
          onSource({ sourceId: s.id, sourceName: s.name, page, hasNextPage: r.hasNextPage, items: r.items })
        } catch (e) {
          onSource({ sourceId: s.id, sourceName: s.name, page, hasNextPage: false, items: [], error: String(e) })
        }
      })
    )
  }

  /** True when the source exposes a homepage. */
  hasHome(sourceId: string): boolean {
    const source = this.require(sourceId)
    return !!source.getHomeSections && !!source.getHomeSection
  }

  async getHomeSections(sourceId: string): Promise<HomeSection[]> {
    const source = this.require(sourceId)
    if (!source.getHomeSections) throw new Error(`source ${sourceId} has no homepage`)
    return source.getHomeSections(this.ctxFor(sourceId))
  }

  async getHomeSection(sourceId: string, sectionId: string, page: number): Promise<SearchResults> {
    const source = this.require(sourceId)
    if (!source.getHomeSection) throw new Error(`source ${sourceId} has no homepage`)
    return source.getHomeSection(this.ctxFor(sourceId), sectionId, page)
  }

  async getMedia(sourceId: string, mediaId: string): Promise<Media> {
    const source = this.require(sourceId)
    return source.getMedia(this.ctxFor(sourceId), mediaId)
  }

  async getEpisodes(sourceId: string, mediaId: string): Promise<Episode[]> {
    const source = this.require(sourceId)
    return source.getEpisodes(this.ctxFor(sourceId), mediaId)
  }

  async getChapterContent(sourceId: string, mediaId: string, episodeId: string): Promise<ChapterContent> {
    const source = this.require(sourceId)
    return source.getChapterContent(this.ctxFor(sourceId), mediaId, episodeId)
  }

  async getStreams(sourceId: string, media: Media, episode: Episode): Promise<StreamSource[]> {
    const source = this.require(sourceId)
    if (!source.getStreams) throw new Error(`source ${sourceId} has no video streams`)
    return source.getStreams(this.ctxFor(sourceId), media, episode)
  }

  private require(id: string): Source {
    const source = this.sources.get(id)
    if (!source) throw new Error(`unknown source: ${id}`)
    return source
  }
}

const noopPrefs: PreferencesApi = {
  async get() {
    return undefined
  },
  async getWithDefault(_pluginId, _key, fallback) {
    return fallback
  },
  async set() {}
}

/** Wraps a PreferencesApi so a plugin reads/writes its own plugin id's keys. */
function bindPrefs(prefs: PreferencesApi, pluginId: string): SourcePrefs {
  return {
    get<T extends PreferenceValue>(key: string): Promise<T | undefined> {
      return prefs.get(pluginId, key)
    },
    getWithDefault<T extends PreferenceValue>(key: string, fallback: T): Promise<T> {
      return prefs.getWithDefault(pluginId, key, fallback)
    },
    set(key: string, value: PreferenceValue): Promise<void> {
      return prefs.set(pluginId, key, value)
    }
  }
}
