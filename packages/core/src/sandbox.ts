import type {
  ChapterContent,
  Episode,
  FetchInit,
  FetchResult,
  HomeSection,
  Media,
  MediaType,
  PluginManifest,
  PreferenceValue,
  PreferencesApi,
  SearchResults,
  Source,
  StreamSource
} from './types.js'

/** A plugin error crossing a postMessage boundary; Error objects cannot be cloned. */
export interface SerializedError {
  name: string
  message: string
  stack?: string
}

export type SandboxOp = 'fetch' | 'cacheGet' | 'cacheSet' | 'prefsGet' | 'prefsGetWithDefault' | 'prefsSet'

/** Messages sent from the main thread into the plugin worker. */
export type MainToWorker =
  | { type: 'load'; code: string }
  | { type: 'call'; cid: number; sourceId: string; method: string; args: unknown[] }
  | { type: 'res'; cid: number; ok: true; value?: unknown }
  | { type: 'res'; cid: number; ok: false; error: SerializedError }

/** Messages sent from the plugin worker back to the main thread. */
export type WorkerToMain =
  | { type: 'ready'; manifest: PluginManifest; sources: SandboxSourceInfo[] }
  | { type: 'loadError'; message: string }
  | { type: 'result'; cid: number; ok: true; value?: unknown }
  | { type: 'result'; cid: number; ok: false; error: SerializedError }
  | { type: 'req'; cid: number; sourceId: string; op: SandboxOp; args: unknown[] }

export interface SandboxSourceInfo {
  id: string
  name: string
  mediaTypes: MediaType[]
  lang?: string
  methods: string[]
}

/** Async cache access for the sandbox (TTLCache.get/set are sync, so the app adapts). */
export interface SandboxCache {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
}

export interface SandboxCtx {
  /** throttled, timed-out fetch for the given source */
  fetch(sourceId: string, url: string, init?: FetchInit): Promise<FetchResult>
  cache: SandboxCache
  prefs: PreferencesApi
}

export interface SandboxTransport {
  post(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): void
  onError(cb: (e: unknown) => void): void
  terminate(): void
}

export interface LoadSandboxOptions {
  code: string
  ctx: SandboxCtx
  /** called once per worker instance, so a crashed worker can be relaunched */
  createTransport: () => SandboxTransport
}

export interface PluginSandbox {
  manifest: PluginManifest
  /** proxy Source objects that round-trip their calls into the worker */
  sources: Source[]
  invoke(sourceId: string, method: string, args: unknown[]): Promise<unknown>
  terminate(): void
}

type Call = { resolve(value: unknown): void; reject(error: Error): void }

export function serializeError(e: unknown): SerializedError {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack }
  return { name: 'Error', message: String(e) }
}

export function deserializeError(err: SerializedError): Error {
  const e = new Error(err.message)
  e.name = err.name
  if (err.stack) e.stack = err.stack
  return e
}

class SandboxRuntime implements PluginSandbox {
  manifest!: PluginManifest
  sources: Source[] = []

  private transport!: SandboxTransport
  private pendingCalls = new Map<number, Call>()
  private cid = 0
  private crashed = false
  private disposed = false
  private readyPromise: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (e: Error) => void

  constructor(private opts: LoadSandboxOptions) {
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.launch()
  }

  private launch(): void {
    const transport = this.opts.createTransport()
    this.transport = transport
    transport.onMessage((raw) => this.handle(raw))
    transport.onError((e) => this.handleError(e instanceof Error ? e : new Error(String(e))))
    transport.post({ type: 'load', code: this.opts.code })
  }

  private handle(raw: unknown): void {
    const msg = raw as WorkerToMain
    switch (msg.type) {
      case 'ready': {
        this.manifest = msg.manifest
        this.sources = msg.sources.map((info) => this.proxySource(info))
        this.readyResolve()
        break
      }
      case 'loadError': {
        this.handleError(new Error(msg.message))
        break
      }
      case 'result': {
        const call = this.pendingCalls.get(msg.cid)
        if (!call) break
        this.pendingCalls.delete(msg.cid)
        if (msg.ok) call.resolve(msg.value)
        else call.reject(deserializeError(msg.error))
        break
      }
      case 'req': {
        // Pin the reply to the transport that received the request: after a
        // crash+relaunch the stale request's reply must go to the dead worker,
        // not the new one's fresh cid space.
        const transport = this.transport
        this.service(msg, transport).catch((e) => {
          transport.post({ type: 'res', cid: msg.cid, ok: false, error: serializeError(e) })
        })
        break
      }
    }
  }

  private async service(req: Extract<WorkerToMain, { type: 'req' }>, transport: SandboxTransport): Promise<void> {
    const pluginId = this.manifest?.id ?? 'plugin'
    let value: unknown
    switch (req.op) {
      case 'fetch': {
        const [url, init] = req.args as [string, FetchInit?]
        value = await this.opts.ctx.fetch(req.sourceId, url, init)
        break
      }
      case 'cacheGet': {
        const [key] = req.args as [string]
        value = await this.opts.ctx.cache.get(`${pluginId}\u0000${key}`)
        break
      }
      case 'cacheSet': {
        const [key, ttlMs, v] = req.args as [string, number, unknown]
        await this.opts.ctx.cache.set(`${pluginId}\u0000${key}`, v, ttlMs)
        break
      }
      case 'prefsGet': {
        const [key] = req.args as [string]
        value = await this.opts.ctx.prefs.get<PreferenceValue>(pluginId, key)
        break
      }
      case 'prefsGetWithDefault': {
        const [key, fallback] = req.args as [string, PreferenceValue]
        value = await this.opts.ctx.prefs.getWithDefault(pluginId, key, fallback)
        break
      }
      case 'prefsSet': {
        const [key, v] = req.args as [string, PreferenceValue]
        await this.opts.ctx.prefs.set(pluginId, key, v)
        break
      }
    }
    transport.post({ type: 'res', cid: req.cid, ok: true, value })
  }

  private handleError(e: Error): void {
    if (this.crashed) return
    this.crashed = true
    for (const call of this.pendingCalls.values()) call.reject(e)
    this.pendingCalls.clear()
    this.readyReject(e)
  }

  waitLoaded(): Promise<void> {
    return this.readyPromise
  }

  invoke(sourceId: string, method: string, args: unknown[]): Promise<unknown> {
    // Happy path posts synchronously so concurrent calls (e.g. searchAll fanning
    // out across a plugin's sources) run in parallel instead of serializing.
    if (!this.crashed && !this.disposed) return this.callOnce(sourceId, method, args)
    return this.ensureAlive().then(() => this.callOnce(sourceId, method, args))
  }

  private async ensureAlive(): Promise<void> {
    if (this.disposed) throw new Error('plugin sandbox was disposed')
    if (!this.crashed) return
    this.crashed = false
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.launch()
    await this.readyPromise
  }

  private callOnce(sourceId: string, method: string, args: unknown[]): Promise<unknown> {
    const cid = ++this.cid
    return new Promise((resolve, reject) => {
      this.pendingCalls.set(cid, { resolve, reject })
      this.transport.post({ type: 'call', cid, sourceId, method, args })
    })
  }

  terminate(): void {
    this.disposed = true
    this.handleError(new Error('plugin sandbox terminated'))
    this.transport.terminate()
  }

  private proxySource(info: SandboxSourceInfo): Source {
    const invoke = (method: string, args: unknown[]) => this.invoke(info.id, method, args)
    const source: Source = {
      id: info.id,
      name: info.name,
      mediaTypes: info.mediaTypes,
      ...(info.lang ? { lang: info.lang } : {}),
      search: (_ctx, query, page) => invoke('search', [query, page]) as Promise<SearchResults>,
      getMedia: (_ctx, mediaId) => invoke('getMedia', [mediaId]) as Promise<Media>,
      getEpisodes: (_ctx, mediaId) => invoke('getEpisodes', [mediaId]) as Promise<Episode[]>,
      getChapterContent: (_ctx, mediaId, episodeId) => invoke('getChapterContent', [mediaId, episodeId]) as Promise<ChapterContent>
    }
    if (info.methods.includes('getStreams')) {
      source.getStreams = (_ctx, media, episode) => invoke('getStreams', [media, episode]) as Promise<StreamSource[]>
    }
    if (info.methods.includes('getHomeSections')) {
      source.getHomeSections = () => invoke('getHomeSections', []) as Promise<HomeSection[]>
    }
    if (info.methods.includes('getHomeSection')) {
      source.getHomeSection = (_ctx, sectionId, page) => invoke('getHomeSection', [sectionId, page]) as Promise<SearchResults>
    }
    return source
  }
}

/** Eval a plugin bundle inside a sandboxed worker and return proxy Sources. */
export async function loadPluginSandbox(opts: LoadSandboxOptions): Promise<PluginSandbox> {
  const sb = new SandboxRuntime(opts)
  try {
    await sb.waitLoaded()
    return sb
  } catch (e) {
    sb.terminate()
    throw e
  }
}
