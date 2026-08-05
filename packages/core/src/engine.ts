import type {
  ChapterContent,
  CacheApi,
  Episode,
  FetchFn,
  FetchInit,
  FetchResult,
  Media,
  PreferencesApi,
  SearchResults,
  Source,
  StreamSource
} from './types.js'
import { TTLCache } from './cache.js'

export interface EngineOptions {
  fetch: FetchFn
  cache?: CacheApi
  /** minimum gap between fetches to the same source (anti-ban). default 300ms */
  sourceThrottleMs?: number
  /** optional per-source preferences; absent sources get a no-op backend */
  sourcePrefs?: PreferencesApi
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
  readonly cache: CacheApi
  readonly prefs: PreferencesApi
  private throttles = new Map<string, ThrottledFetch>()

  constructor(private opts: EngineOptions) {
    this.cache = opts.cache ?? new TTLCache()
    this.prefs = opts.sourcePrefs ?? noopPrefs
  }

  registerSource(source: Source): void {
    this.sources.set(source.id, source)
  }

  getSource(id: string): Source | undefined {
    return this.sources.get(id)
  }

  listSources(): Source[] {
    return [...this.sources.values()]
  }

  private ctxFor(sourceId: string) {
    const throttle = this.throttles.get(sourceId) ?? new ThrottledFetch(this.opts.fetch, this.opts.sourceThrottleMs ?? 300)
    this.throttles.set(sourceId, throttle)
    const fetch: FetchFn = (url, init) => throttle.call(sourceId, url, init)
    return { fetch, cache: this.cache, preferences: this.prefs }
  }

  async search(sourceId: string, query: string, page: number): Promise<SearchResults> {
    const source = this.require(sourceId)
    return source.search(this.ctxFor(sourceId), query, page)
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
  async getWithDefault(_sourceId, _key, fallback) {
    return fallback
  },
  async set() {}
}
