import {
  Engine,
  IndexedDbStore,
  MemoryStore,
  PluginRegistry,
  TTLCache,
  loadBundle,
  sha256Hex,
  validateManifest,
  type FetchFn,
  type FetchInit,
  type FetchResult,
  type LibraryStore,
  type PluginRegistration
} from '@media-platform/core'

/** Tauri command bridge — resolves only when running inside the native shell. */
declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
    }
    __media_plugin_register?: (r: PluginRegistration) => void
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
}

/**
 * The FetchProvider. Native Tauri: routes to Rust `fetch_url` (reqwest, no
 * CORS). Plain browser (dev / web build): tries direct fetch — works only for
 * CORS-enabled APIs like MangaDex. mode:'dom' is not supported in the browser.
 */
export function createFetchProvider(): FetchFn {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (invoke) {
    return async (url: string, init?: FetchInit): Promise<FetchResult> => {
      const res = (await invoke('fetch_url', {
        url,
        method: init?.method ?? 'GET',
        headers: init?.headers ?? {},
        body: init?.body,
        dom: init?.mode === 'dom'
      })) as FetchResult
      return res
    }
  }

  return async (url: string, init?: FetchInit): Promise<FetchResult> => {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.headers,
      body: init?.body
    })
    const body = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => (headers[k] = v))
    return { status: res.status, headers, body }
  }
}

export interface AppRuntime {
  engine: Engine
  registry: PluginRegistry
  store: LibraryStore
  installed: Map<string, string> // pluginId -> version
  setInstalled(pluginId: string, version: string): void
  uninstall(pluginId: string): void
  /**
   * Download + verify + load an external plugin bundle.
   * Throws on sha256 mismatch, invalid manifest, or apiVersion mismatch.
   */
  installExternal(plugin: { id: string; version: string; url: string; sha256: string; manifestUrl?: string }): Promise<void>
}

let runtimePromise: Promise<AppRuntime> | undefined

export function getRuntime(): Promise<AppRuntime> {
  if (!runtimePromise) runtimePromise = initRuntime()
  return runtimePromise
}

async function initRuntime(): Promise<AppRuntime> {
  const store: LibraryStore = isTauri() ? new MemoryStore() : new IndexedDbStore()

  const installed = new Map<string, string>()

  const engine = new Engine({ fetch: createFetchProvider(), cache: new TTLCache(), sourceThrottleMs: 300 })
  const registry = new PluginRegistry()

  async function loadFromBundle(code: string, origin: 'bundled' | 'external'): Promise<void> {
    const registration = loadBundle(code)
    if (origin === 'bundled') registry.registerBundled(registration)
    else registry.registerExternal(registration)
    for (const source of registration.sources) engine.registerSource(source)
  }

  // First-party plugins are compiled into the app (bundle format, same loader).
  const mangadexBuilt = await import('@media-platform/plugin-mangadex/dist/mangadex.plugin.js?raw')
  await loadFromBundle(mangadexBuilt.default, 'bundled')
  const videoBuilt = await import('@media-platform/plugin-examplevideo/dist/examplevideo.plugin.js?raw')
  await loadFromBundle(videoBuilt.default, 'bundled')

  return {
    engine,
    registry,
    store,
    installed,
    setInstalled(id, version) {
      installed.set(id, version)
    },
    uninstall(id) {
      installed.delete(id)
      registry.unregister(id)
    },
    async installExternal(plugin) {
      const provider = createFetchProvider()
      const codeRes = await provider(plugin.url)
      if (codeRes.status < 200 || codeRes.status >= 300) throw new Error(`download ${plugin.url} -> HTTP ${codeRes.status}`)
      const code = codeRes.body

      const actual = await sha256Hex(code)
      if (actual !== plugin.sha256.toLowerCase()) {
        throw new Error(`sha256 mismatch for ${plugin.id}: expected ${plugin.sha256}, got ${actual}`)
      }

      // Validate the sidecar manifest before evaluating the bundle.
      if (plugin.manifestUrl) {
        const mf = await provider(plugin.manifestUrl)
        if (mf.status < 200 || mf.status >= 300) throw new Error(`manifest ${plugin.manifestUrl} -> HTTP ${mf.status}`)
        validateManifest(JSON.parse(mf.body))
      }

      const registration = loadBundle(code)
      const manifest = validateManifest(registration.manifest)
      if (manifest.id !== plugin.id) throw new Error(`manifest id ${manifest.id} != ${plugin.id}`)
      if (manifest.apiVersion !== registration.manifest.apiVersion) throw new Error('internal manifest mismatch')
      registry.registerExternal(registration)
      for (const source of registration.sources) engine.registerSource(source)
      installed.set(plugin.id, plugin.version)
    }
  }
}
