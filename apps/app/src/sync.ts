import type { LibraryStore, LibraryStoreWriteMethod } from '@woyomi/core'

export interface SyncConfig {
  server: string
  user: string
  token: string
}

export function syncConfigured(config: SyncConfig): boolean {
  return config.server.trim() !== '' && config.user.trim() !== ''
}

function syncUrl(config: SyncConfig): string {
  return `${config.server.trim().replace(/\/+$/, '')}/api/sync/${encodeURIComponent(config.user.trim())}`
}

function syncInit(config: SyncConfig, init: RequestInit = {}): RequestInit {
  const headers: Record<string, string> = { ...Object.fromEntries(new Headers(init.headers)) }
  if (config.token.trim()) headers.authorization = `Bearer ${config.token.trim()}`
  return { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15_000) }
}

function throwHttp(res: Response, verb: string): never {
  throw new Error(`sync ${verb} -> HTTP ${res.status}`)
}

export async function pushSync(store: LibraryStore, config: SyncConfig): Promise<void> {
  const res = await fetch(
    syncUrl(config),
    syncInit(config, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: await store.exportJson() })
  )
  if (!res.ok) throwHttp(res, 'push')
  // The server merges its stored state with our payload and returns the result;
  // adopting it keeps our local copy in step with any concurrent edits.
  await store.importJson(await res.text())
}

export async function pullSync(store: LibraryStore, config: SyncConfig): Promise<void> {
  const res = await fetch(syncUrl(config), syncInit(config))
  if (!res.ok) throwHttp(res, 'pull')
  await store.importJson(await res.text())
}

/** Manual mutations that should be synced; NOT importJson (sync adopts via that). */
const WRITE_METHODS: Record<LibraryStoreWriteMethod, true> = {
  add: true,
  updateStatus: true,
  remove: true,
  setSeen: true,
  setSeenMany: true,
  unsetSeen: true,
  unsetSeenMany: true,
  addHistory: true,
  removeHistory: true
}

/**
 * Wrap a store so every successful local library mutation marks it dirty, which
 * the auto-sync loop turns into a push. Failed writes do not schedule a push,
 * and reads and importJson pass through: reads have nothing to sync, and
 * importJson is what push/pull use to adopt the server result — wrapping it
 * would push↔adopt eternally. The `Record` above fails to compile when a new
 * `LibraryStoreWriteMethod` is added without updating this list.
 */
export function makeSyncingStore(store: LibraryStore, markDirty: () => void): LibraryStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const method = Reflect.get(target, prop, receiver)
      if (typeof prop === 'string' && Object.hasOwn(WRITE_METHODS, prop)) {
        return ((...args: never[]) => {
          const result = (method as (...a: never[]) => unknown).apply(target, args)
          if (result instanceof Promise) {
            return result.then((value) => {
              markDirty()
              return value
            })
          }
          markDirty()
          return result
        }) as never
      }
      return method
    }
  })
}

const DEBOUNCE_MS = 1500

export interface AutoSyncDeps {
  getConfig: () => Promise<SyncConfig>
  /** Lazily resolved so the caller can wrap its store after starting auto-sync. */
  getStore: () => LibraryStore
  isEnabled: () => Promise<boolean>
}

/**
 * Wire auto-sync into the app: a one-shot pull on start (adopting any changes
 * from other devices) plus a debounced push whenever the store is marked
 * dirty by a local write. Failures are swallowed — the next write or start
 * retries — matching the quiet, single-owner design.
 */
export function startAutoSync(deps: AutoSyncDeps): { stop: () => void; markDirty: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const push = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void (async () => {
        if (stopped || !(await deps.isEnabled())) return
        const config = await deps.getConfig()
        if (!syncConfigured(config)) return
        await pushSync(deps.getStore(), config)
      })().catch(() => {
        /* offline etc.; next write or start retries */
      })
    }, DEBOUNCE_MS)
  }

  void (async () => {
    if (!(await deps.isEnabled())) return
    const config = await deps.getConfig()
    if (!syncConfigured(config)) return
    await pullSync(deps.getStore(), config).catch(() => {})
  })()

  return {
    markDirty: push,
    stop() {
      stopped = true
      clearTimeout(timer)
    }
  }
}
