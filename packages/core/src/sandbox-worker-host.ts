import type { FetchResult, PluginRegistration, SourceContext } from './types.js'
import { deserializeError, serializeError, type MainToWorker, type SandboxOp, type WorkerToMain } from './sandbox.js'

const REGISTER_KEY = '__media_plugin_register'

/**
 * Runs inside a plugin Web Worker. Receives `{type:'load'}` with the bundle
 * code, evals it to capture the registration, then serves `{type:'call'}`
 * invocations. The plugin's `SourceContext` (fetch/cache/preferences) is
 * served by posting requests back to the main thread and awaiting replies —
 * functions cannot cross postMessage, so the worker never holds the real
 * implementations.
 *
 * The `deps` seam keeps this testable in-process (Node has no Worker).
 */
export interface PluginWorkerHostDeps {
  post?(msg: WorkerToMain): void
  onMessage?(handler: (msg: MainToWorker) => void): void
  /** a DOM parser to expose to plugins (the app injects linkedom's DOMParser) */
  domParser?: unknown
}

export function runPluginWorkerHost(deps: PluginWorkerHostDeps = {}): void {
  const post = deps.post ?? ((msg: WorkerToMain) => (globalThis as unknown as { postMessage(m: unknown): void }).postMessage(msg))
  const onMessage = deps.onMessage ?? ((handler: (msg: MainToWorker) => void) => {
    ;(globalThis as unknown as { onmessage: ((ev: { data: MainToWorker }) => void) | null }).onmessage = (ev) => handler(ev.data)
  })

  if (deps.domParser) (globalThis as Record<string, unknown>).DOMParser = deps.domParser

  let registration: PluginRegistration | undefined
  let nextCid = 1
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>()

  function rpc(sourceId: string, op: SandboxOp, args: unknown[]): Promise<unknown> {
    const cid = nextCid++
    return new Promise((resolve, reject) => {
      pending.set(cid, { resolve, reject })
      post({ type: 'req', cid, sourceId, op, args })
    })
  }

  function makeCtx(sourceId: string): SourceContext {
    return {
      fetch: (url, init) => rpc(sourceId, 'fetch', [url, init]) as Promise<FetchResult>,
      cache: {
        withCache: async <T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> => {
          const hit = await rpc(sourceId, 'cacheGet', [key])
          if (hit !== undefined) return hit as T
          const value = await compute()
          await rpc(sourceId, 'cacheSet', [key, ttlMs, value])
          return value
        }
      },
      preferences: {
        get: <T>(key: string) => rpc(sourceId, 'prefsGet', [key]) as Promise<T | undefined>,
        getWithDefault: <T>(key: string, fallback: T) => rpc(sourceId, 'prefsGetWithDefault', [key, fallback]) as Promise<T>,
        set: (key, value) => rpc(sourceId, 'prefsSet', [key, value]) as Promise<void>
      }
    }
  }

  const SOURCE_METHODS = ['search', 'getMedia', 'getEpisodes', 'getChapterContent', 'getStreams', 'getHomeSections', 'getHomeSection'] as const

  onMessage((msg) => {
    if (msg.type === 'load') {
      try {
        const captured: PluginRegistration[] = []
        const prev = (globalThis as Record<string, unknown>)[REGISTER_KEY]
        ;(globalThis as Record<string, unknown>)[REGISTER_KEY] = (reg: PluginRegistration) => captured.push(reg)
        try {
          // eslint-disable-next-line no-new-func
          new Function(msg.code)()
        } finally {
          if (prev === undefined) delete (globalThis as Record<string, unknown>)[REGISTER_KEY]
          else (globalThis as Record<string, unknown>)[REGISTER_KEY] = prev
        }
        if (captured.length !== 1) throw new Error('plugin did not register exactly once')
        registration = captured[0]!
        const infos = registration.sources.map((s) => ({
          id: s.id,
          name: s.name,
          mediaTypes: s.mediaTypes,
          ...(s.lang ? { lang: s.lang } : {}),
          methods: SOURCE_METHODS.filter((m) => typeof s[m] === 'function')
        }))
        post({ type: 'ready', manifest: registration.manifest, sources: infos })
      } catch (e) {
        post({ type: 'loadError', message: String(e) })
      }
      return
    }

    if (msg.type === 'res') {
      const call = pending.get(msg.cid)
      if (!call) return
      pending.delete(msg.cid)
      if (msg.ok) call.resolve(msg.value)
      else call.reject(deserializeError(msg.error))
      return
    }

    if (msg.type === 'call') {
      const { cid, sourceId, method, args } = msg
      void (async () => {
        try {
          const source = registration?.sources.find((s) => s.id === sourceId)
          if (!source) throw new Error(`unknown source: ${sourceId}`)
          const fn = (source as unknown as Record<string, unknown>)[method]
          if (typeof fn !== 'function') throw new Error(`source ${sourceId} has no method ${method}`)
          const value = await (fn as (...a: unknown[]) => Promise<unknown>).call(source, makeCtx(sourceId), ...args)
          post({ type: 'result', cid, ok: true, value })
        } catch (e) {
          post({ type: 'result', cid, ok: false, error: serializeError(e) })
        }
      })()
    }
  })
}