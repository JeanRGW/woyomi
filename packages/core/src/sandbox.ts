import { z } from 'zod'
import {
  ChapterContentSchema,
  EpisodeSchema,
  HomeSectionSchema,
  MediaSchema,
  MediaTypeSchema,
  PluginManifestSchema,
  SearchResultsSchema,
  StreamSourceSchemaArray
} from './protocol.js'
import type {
  FetchInit,
  FetchResult,
  MediaType,
  PluginManifest,
  PreferenceValue,
  PreferencesApi,
  Source
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

type Call = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

/** Generous ceiling for a single plugin call (and worker ctx request); a wedged worker must not hang callers forever. */
export const SANDBOX_CALL_TIMEOUT_MS = 120_000

const SerializedErrorSchema = z.object({ name: z.string(), message: z.string(), stack: z.string().optional() })

const SandboxSourceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaTypes: z.array(MediaTypeSchema),
  lang: z.string().optional(),
  methods: z.array(z.string())
})

/**
 * Worker messages are untrusted: plugin code shares the worker with the host
 * and can post anything. The envelope is validated before any field is used.
 */
const WorkerToMainSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), manifest: PluginManifestSchema, sources: z.array(SandboxSourceInfoSchema) }),
  z.object({ type: z.literal('loadError'), message: z.string() }),
  z.object({
    type: z.literal('result'),
    cid: z.number(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: SerializedErrorSchema.optional()
  }),
  z.object({
    type: z.literal('req'),
    cid: z.number(),
    sourceId: z.string(),
    op: z.enum(['fetch', 'cacheGet', 'cacheSet', 'prefsGet', 'prefsGetWithDefault', 'prefsSet']),
    args: z.array(z.unknown())
  })
])

/** Parse a plugin return value against its protocol schema, naming the shape on failure. */
function parseWith<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.join('.') ?? 'value'
    throw new Error(`plugin returned invalid ${label}: ${where} ${issue?.message ?? 'is invalid'}`)
  }
  return parsed.data
}

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
    const parsed = WorkerToMainSchema.safeParse(raw)
    if (!parsed.success) {
      this.handleError(new Error('plugin sandbox sent a malformed message'))
      return
    }
    const msg = parsed.data as WorkerToMain
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
        clearTimeout(call.timer)
        if (msg.ok) call.resolve(msg.value)
        else call.reject(deserializeError(msg.error ?? { name: 'Error', message: 'plugin call failed' }))
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
        const [url, init] = req.args
        if (typeof url !== 'string') throw new Error('fetch: url must be a string')
        value = await this.opts.ctx.fetch(req.sourceId, url, init as FetchInit | undefined)
        break
      }
      case 'cacheGet': {
        const [key] = req.args
        if (typeof key !== 'string') throw new Error('cacheGet: key must be a string')
        value = await this.opts.ctx.cache.get(`${pluginId}\u0000${key}`)
        break
      }
      case 'cacheSet': {
        const [key, ttlMs, v] = req.args
        if (typeof key !== 'string' || typeof ttlMs !== 'number' || !Number.isFinite(ttlMs)) {
          throw new Error('cacheSet: key must be a string and ttlMs a number')
        }
        await this.opts.ctx.cache.set(`${pluginId}\u0000${key}`, v, ttlMs)
        break
      }
      case 'prefsGet': {
        const [key] = req.args
        if (typeof key !== 'string') throw new Error('prefsGet: key must be a string')
        value = await this.opts.ctx.prefs.get<PreferenceValue>(pluginId, key)
        break
      }
      case 'prefsGetWithDefault': {
        const [key, fallback] = req.args as [string, PreferenceValue]
        if (typeof key !== 'string') throw new Error('prefsGetWithDefault: key must be a string')
        value = await this.opts.ctx.prefs.getWithDefault(pluginId, key, fallback)
        break
      }
      case 'prefsSet': {
        const [key, v] = req.args as [string, PreferenceValue]
        if (typeof key !== 'string') throw new Error('prefsSet: key must be a string')
        await this.opts.ctx.prefs.set(pluginId, key, v)
        break
      }
    }
    transport.post({ type: 'res', cid: req.cid, ok: true, value })
  }

  private handleError(e: Error): void {
    if (this.crashed) return
    this.crashed = true
    for (const call of this.pendingCalls.values()) {
      clearTimeout(call.timer)
      call.reject(e)
    }
    this.pendingCalls.clear()
    this.readyReject(e)
    // Drop the wedged/crashed worker so a relaunch starts clean instead of
    // leaking the old instance.
    this.transport.terminate()
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
      const timer = setTimeout(() => {
        this.pendingCalls.delete(cid)
        reject(new Error(`plugin call timed out: ${method}`))
      }, SANDBOX_CALL_TIMEOUT_MS)
      this.pendingCalls.set(cid, { resolve, reject, timer })
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
      search: (_ctx, query, page) => invoke('search', [query, page]).then((v) => parseWith(SearchResultsSchema, v, 'search results')),
      getMedia: (_ctx, mediaId) => invoke('getMedia', [mediaId]).then((v) => parseWith(MediaSchema, v, 'media')),
      getEpisodes: (_ctx, mediaId) => invoke('getEpisodes', [mediaId]).then((v) => parseWith(z.array(EpisodeSchema), v, 'episodes')),
      getChapterContent: (_ctx, mediaId, episodeId) =>
        invoke('getChapterContent', [mediaId, episodeId]).then((v) => parseWith(ChapterContentSchema, v, 'chapter content'))
    }
    if (info.methods.includes('getStreams')) {
      source.getStreams = (_ctx, media, episode) => invoke('getStreams', [media, episode]).then((v) => parseWith(StreamSourceSchemaArray, v, 'streams'))
    }
    if (info.methods.includes('getHomeSections')) {
      source.getHomeSections = () => invoke('getHomeSections', []).then((v) => parseWith(z.array(HomeSectionSchema), v, 'home sections'))
    }
    if (info.methods.includes('getHomeSection')) {
      source.getHomeSection = (_ctx, sectionId, page) =>
        invoke('getHomeSection', [sectionId, page]).then((v) => parseWith(SearchResultsSchema, v, 'home section'))
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
