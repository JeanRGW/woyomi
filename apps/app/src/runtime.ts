import {
  Engine,
  IndexedDbStore,
  PluginRegistry,
  TTLCache,
  loadBundle,
  sha256Hex,
  validateManifest,
  type FetchFn,
  type FetchInit,
  type FetchResult,
  type LibraryStore,
  type PluginRegistration,
  type PluginStore,
  type PluginStoredBundle,
  type PreferencesApi
} from '@media-platform/core'
import { SqliteStore } from './sqlite-store'

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
  plugins: PluginStore
  installed: Map<string, string> // pluginId -> version
  setInstalled(pluginId: string, version: string): void
  uninstall(pluginId: string): void
  /** Persist a per-source enable/disable toggle for a plugin. */
  setSourceEnabled(pluginId: string, sourceId: string, enabled: boolean): void
  /** Source ids pinned to the Home landing; empty = nothing pinned (hint shown). */
  getLandingSources(): Promise<string[]>
  setLandingSources(ids: string[]): Promise<void>
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
  const native = isTauri()
  let store: LibraryStore
  let plugins: PluginStore
  let prefs: PreferencesApi

  if (native) {
    const sqlite = new SqliteStore()
    store = sqlite
    plugins = sqlite.pluginStore()
    prefs = sqlite.preferencesApi()
  } else {
    const idb = new IndexedDbStore()
    store = idb
    plugins = idb.pluginStore()
    prefs = idb.preferencesApi()
  }

  const installed = new Map<string, string>()

  const engine = new Engine({ fetch: createFetchProvider(), cache: new TTLCache(), sourceThrottleMs: 300, sourcePrefs: prefs })
  const registry = new PluginRegistry()

  async function loadFromBundle(code: string, origin: 'bundled' | 'external'): Promise<void> {
    const registration = loadBundle(code)
    if (origin === 'bundled') registry.registerBundled(registration)
    else registry.registerExternal(registration)
    for (const source of registration.sources) engine.registerSource(source, registration.manifest.id)
  }

  async function loadInstalled(plugin: PluginStoredBundle): Promise<void> {
    try {
      const registration = loadBundle(plugin.code)
      if (registration.manifest.id !== plugin.id) return
      registry.registerExternal(registration)
      for (const source of registration.sources) engine.registerSource(source, registration.manifest.id)
      installed.set(plugin.id, plugin.manifest.version)
    } catch (e) {
      // A plugin whose code no longer matches its stored manifest is dropped
      // rather than blocking app boot.
      console.warn(`dropping stored plugin ${plugin.id}:`, e)
    }
  }

  // First-party plugins are compiled into the app (bundle format, same loader).
  const mangadexBuilt = await import('@media-platform/plugin-mangadex/dist/mangadex.plugin.js?raw')
  await loadFromBundle(mangadexBuilt.default, 'bundled')
  const videoBuilt = await import('@media-platform/plugin-examplevideo/dist/examplevideo.plugin.js?raw')
  await loadFromBundle(videoBuilt.default, 'bundled')

  // Rehydrate externally-installed plugins across restarts.
  for (const plugin of await plugins.list()) {
    await loadInstalled(plugin)
  }

  // Apply persisted per-source toggles (keyed per plugin under 'sources.enabled').
  for (const plugin of registry.list()) {
    const disabled = await prefs.get<string[]>(plugin.registration.manifest.id, 'sources.disabled')
    if (disabled) {
      for (const source of plugin.registration.sources) {
        registry.setSourceEnabled(source.id, !disabled.includes(source.id))
      }
    }
  }

  async function setSourceEnabled(pluginId: string, sourceId: string, enabled: boolean): Promise<void> {
    registry.setSourceEnabled(sourceId, enabled)
    const disabled = (await prefs.get<string[]>(pluginId, 'sources.disabled')) ?? []
    const next = enabled ? disabled.filter((s) => s !== sourceId) : [...new Set([...disabled, sourceId])]
    await prefs.set(pluginId, 'sources.disabled', next)
  }

  return {
    engine,
    registry,
    store,
    plugins,
    installed,
    setInstalled(id, version) {
      installed.set(id, version)
    },
    uninstall(id) {
      installed.delete(id)
      registry.unregister(id)
      void plugins.remove(id)
    },
    setSourceEnabled,
    getLandingSources: async () => (await prefs.get<string[]>('__app', 'landing.sources')) ?? [],
    setLandingSources: (ids: string[]) => prefs.set('__app', 'landing.sources', ids),
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
      for (const source of registration.sources) engine.registerSource(source, registration.manifest.id)
      installed.set(plugin.id, plugin.version)

      await plugins.save({ id: plugin.id, code, sha256: actual, manifest })
    }
  }
}
