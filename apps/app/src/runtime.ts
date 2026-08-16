import {
  Engine,
  IndexedDbStore,
  PluginRegistry,
  TTLCache,
  loadPluginSandbox,
  sha256Hex,
  validateManifest,
  type FetchFn,
  type FetchInit,
  type FetchResult,
  type Episode,
  type LibraryStore,
  type MediaPageCache,
  type Media,
  type PluginRegistration,
  type PluginSandbox,
  type PluginStore,
  type PluginStoredBundle,
  type PreferencesApi,
  type SandboxCtx,
  type SandboxTransport
} from '@woyomi/core'
import { DownloadManager } from './downloads'
import { SqliteStore } from './sqlite-store'
import { annotateFetchError, isNetworkError, scrapeRequest, shouldProxy, streamProxyUrl, type ScrapeConfig } from './scrape'
import { makeSyncingStore, startAutoSync, type SyncConfig } from './sync'
import type { LocaleId } from './i18n/messages'

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
 * Resolve the URL the <video> should load. Streams with custom headers (e.g.
 * animefire's Referer) can't be played directly, so in the native shell we
 * route them through the localhost stream proxy, which applies the headers
 * and forwards Range for seeking. Header-free streams play directly.
 * Web mode: routes through the self-hosted /api/scrape proxy when one is
 * configured (no CORS limits), else direct fetch — which works only for
 * CORS-enabled APIs like MangaDex. Header-gated streams (e.g. animefire's
 * Referer MP4s) are routed through the same server's /api/stream endpoint.
 */
export async function playableStreamUrl(stream: { url: string; headers?: Record<string, string> }): Promise<string> {
  if (!stream.headers || Object.keys(stream.headers).length === 0) return stream.url
  if (!isTauri()) {
    const cfg = getScrapeConfig()
    return cfg.url ? streamProxyUrl(cfg, stream) : stream.url
  }
  const base = (await window.__TAURI_INTERNALS__!.invoke('stream_proxy_base')) as string
  return `${base}/stream?url=${encodeURIComponent(stream.url)}&headers=${encodeURIComponent(JSON.stringify(stream.headers))}`
}

/** Upper bound on an installable plugin bundle, to keep installs sane. */
const MAX_PLUGIN_BYTES = 5 * 1024 * 1024

/**
 * The FetchProvider. Native Tauri: routes to Rust `fetch_url` (reqwest, no
 * CORS). Plain browser (dev / web build): routes through the scrape proxy when
 * one is configured (self-hosted, no CORS limits), else direct fetch — which
 * works only for CORS-enabled APIs like MangaDex. mode:'dom' is rendered by a
 * hidden native WebView and is unavailable in the browser build.
 */

/** Proxy config for the web build; empty url = proxy disabled (direct fetch). */
let scrapeConfig: ScrapeConfig = { url: '', token: '' }

export function setScrapeConfig(config: ScrapeConfig): void {
  scrapeConfig = config
}

export function getScrapeConfig(): ScrapeConfig {
  return scrapeConfig
}

export function createFetchProvider(): FetchFn {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (invoke) {
    return async (url: string, init?: FetchInit): Promise<FetchResult> => {
      const res = (await invoke('fetch_url', {
        args: {
          url,
          method: init?.method ?? 'GET',
          headers: init?.headers ?? {},
          body: init?.body,
          dom: init?.mode === 'dom',
          waitFor: init?.waitFor
        }
      })) as FetchResult
      return res
    }
  }

  return async (url: string, init?: FetchInit): Promise<FetchResult> => {
    try {
      if (init?.mode === 'dom') {
        throw new Error("mode:'dom' requires the native app")
      }
      if (shouldProxy(scrapeConfig, url)) return await scrapeRequest(scrapeConfig, url, init)
      const res = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: init?.headers,
        body: init?.body,
        signal: AbortSignal.timeout(15_000) // ponytail: single choke point; engine needs no per-call timeout
      })
      const body = await res.text()
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => (headers[k] = v))
      return { status: res.status, headers, body }
    } catch (e) {
      // Surface a hint about the proxy on NETWORK failures (fetch rejected:
      // CORS/DNS/unreachable). A non-2xx response from the proxy or the
      // target carries its own message and must not be re-annotated.
      if (isNetworkError(e)) throw annotateFetchError(scrapeConfig, e)
      throw e
    }
  }
}

export interface AppRuntime {
  engine: Engine
  registry: PluginRegistry
  store: LibraryStore
  plugins: PluginStore
  downloads?: DownloadManager
  /** Local snapshot cache for offline media pages; deliberately excluded from sync. */
  mediaCache: MediaPageCache
  /** Save an offline page only for a library or download-backed title. */
  cacheMediaPage(media: Media, episodes: Episode[]): Promise<void>
  /** Remove an unreferenced page snapshot and its native cover. */
  cleanupMediaPage(mediaId: string): Promise<void>
  installed: Map<string, string> // pluginId -> version
  setInstalled(pluginId: string, version: string): void
  uninstall(pluginId: string): void
  /** Persist a per-source enable/disable toggle for a plugin. */
  setSourceEnabled(pluginId: string, sourceId: string, enabled: boolean): void
  /** Persist a whole-plugin enable/disable toggle. */
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<void>
  /** Source ids pinned to the Home landing; empty = nothing pinned (hint shown). */
  getLandingSources(): Promise<string[]>
  setLandingSources(ids: string[]): Promise<void>
  /** Web-mode scrape proxy config. */
  getScrapeConfig(): Promise<ScrapeConfig>
  setScrapeConfig(config: ScrapeConfig): Promise<void>
  /** Server library-sync config. */
  getSyncConfig(): Promise<SyncConfig>
  setSyncConfig(config: SyncConfig): Promise<void>
  /** Auto-sync toggle (default on); sets whether writes/start sync automatically. */
  getAutoSyncEnabled(): Promise<boolean>
  setAutoSyncEnabled(enabled: boolean): Promise<void>
  /** Persisted UI language override; undefined = auto-detect from the OS/browser. */
  getLocale(): Promise<LocaleId | undefined>
  setLocale(locale: LocaleId): Promise<void>
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
  let sqlite: SqliteStore | undefined
  let mediaCache: MediaPageCache

  if (native) {
    sqlite = new SqliteStore()
    store = sqlite
    plugins = sqlite.pluginStore()
    prefs = sqlite.preferencesApi()
    mediaCache = sqlite.mediaPageCache()
  } else {
    const idb = new IndexedDbStore()
    store = idb
    plugins = idb.pluginStore()
    prefs = idb.preferencesApi()
    mediaCache = idb.mediaPageCache()
  }

  // Web-mode proxy config: empty url = direct fetch. Read before the engine
  // is built so createFetchProvider() routes consistently everywhere.
  setScrapeConfig({
    url: (await prefs.get<string>('__app', 'scrape.url')) ?? '',
    token: (await prefs.get<string>('__app', 'scrape.token')) ?? ''
  })

  const autoSyncEnabled = async (): Promise<boolean> => (await prefs.get<boolean>('__app', 'autoSync.enabled')) ?? true
  const syncConfig = async (): Promise<SyncConfig> => ({
    server: (await prefs.get<string>('__app', 'sync.server')) ?? '',
    user: (await prefs.get<string>('__app', 'sync.user')) ?? '',
    token: (await prefs.get<string>('__app', 'sync.token')) ?? ''
  })
  const autoSync = startAutoSync({ getConfig: syncConfig, getStore: () => store, isEnabled: autoSyncEnabled })
  store = makeSyncingStore(store, autoSync.markDirty)

  const installed = new Map<string, string>()
  const sandboxes = new Map<string, PluginSandbox>()
  const cache = new TTLCache()

  const engine = new Engine({
    fetch: createFetchProvider(),
    cache,
    sourceThrottleMs: 300,
    sourcePrefs: prefs,
    canSearch: (id) => registry.sources().some((s) => s.id === id)
  })
  const registry = new PluginRegistry()

  /** Context handed to the sandbox: fetch routes through the engine's throttle+timeout. */
  function sandboxCtx(): SandboxCtx {
    return {
      fetch: (sourceId, url, init) => engine.getSourceFetch(sourceId)(url, init),
      cache: {
        get: (key) => Promise.resolve(cache.get(key)),
        set: (key, value, ttlMs) => Promise.resolve(cache.set(key, value, ttlMs))
      },
      prefs
    }
  }

  function createSandboxTransport(): SandboxTransport {
    const worker = new Worker(new URL('./plugin-worker.ts', import.meta.url), { type: 'module' })
    return {
      post: (msg) => worker.postMessage(msg),
      onMessage: (cb) => {
        worker.onmessage = (ev) => cb(ev.data)
      },
      onError: (cb) => {
        worker.onerror = () => {
          cb(new Error('plugin worker error'))
          return false
        }
      },
      terminate: () => worker.terminate()
    }
  }

  function createSandbox(code: string): Promise<PluginSandbox> {
    return loadPluginSandbox({ code, ctx: sandboxCtx(), createTransport: createSandboxTransport })
  }

  function registerPlugin(sandbox: PluginSandbox, origin: 'bundled' | 'external'): void {
    const registration: PluginRegistration = { manifest: sandbox.manifest, sources: sandbox.sources }
    if (origin === 'bundled') registry.registerBundled(registration)
    else registry.registerExternal(registration)
    for (const source of sandbox.sources) engine.registerSource(source, sandbox.manifest.id)
    sandboxes.set(sandbox.manifest.id, sandbox)
  }

  async function loadFromBundle(code: string, origin: 'bundled' | 'external'): Promise<void> {
    registerPlugin(await createSandbox(code), origin)
  }

  async function loadInstalled(plugin: PluginStoredBundle): Promise<void> {
    let sandbox: PluginSandbox | undefined
    try {
      if (plugin.code.length > MAX_PLUGIN_BYTES) throw new Error('stored plugin bundle too large')
      sandbox = await createSandbox(plugin.code)
      if (sandbox.manifest.id !== plugin.id) {
        sandbox.terminate()
        return
      }
      registerPlugin(sandbox, 'external')
      installed.set(plugin.id, plugin.manifest.version)
    } catch (e) {
      sandbox?.terminate()
      // A plugin whose code no longer matches its stored manifest is dropped
      // rather than blocking app boot.
      console.warn(`dropping stored plugin ${plugin.id}:`, e)
    }
  }

  // First-party plugins are compiled into the app (bundle format, same loader).
  const mangadexBuilt = await import('@woyomi/plugin-mangadex/dist/mangadex.plugin.js?raw')
  await loadFromBundle(mangadexBuilt.default, 'bundled')
  const videoBuilt = await import('@woyomi/plugin-examplevideo/dist/examplevideo.plugin.js?raw')
  await loadFromBundle(videoBuilt.default, 'bundled')
  const tsundokuBuilt = await import('@woyomi/plugin-tsundoku/dist/tsundoku.plugin.js?raw')
  await loadFromBundle(tsundokuBuilt.default, 'bundled')
  const animefireBuilt = await import('@woyomi/plugin-animefire/dist/animefire.plugin.js?raw')
  await loadFromBundle(animefireBuilt.default, 'bundled')

  // Rehydrate externally-installed plugins across restarts.
  for (const plugin of await plugins.list()) {
    await loadInstalled(plugin)
  }

  // Apply persisted per-source toggles (keyed per plugin under 'sources.disabled').
  for (const plugin of registry.list()) {
    const disabled = await prefs.get<string[]>(plugin.registration.manifest.id, 'sources.disabled')
    if (disabled) {
      for (const source of plugin.registration.sources) {
        registry.setSourceEnabled(source.id, !disabled.includes(source.id))
      }
    }
  }

  // Reapply persisted whole-plugin enable toggles.
  for (const plugin of registry.list()) {
    const enabled = await prefs.get<boolean>(plugin.registration.manifest.id, 'plugin.enabled')
    if (enabled === false) registry.setEnabled(plugin.registration.manifest.id, false)
  }

  async function setSourceEnabled(pluginId: string, sourceId: string, enabled: boolean): Promise<void> {
    registry.setSourceEnabled(sourceId, enabled)
    const disabled = (await prefs.get<string[]>(pluginId, 'sources.disabled')) ?? []
    const next = enabled ? disabled.filter((s) => s !== sourceId) : [...new Set([...disabled, sourceId])]
    await prefs.set(pluginId, 'sources.disabled', next)
  }

  async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    registry.setEnabled(pluginId, enabled)
    await prefs.set(pluginId, 'plugin.enabled', enabled)
  }

  const downloads = sqlite
    ? new DownloadManager(engine, sqlite.downloadStore(), (cmd, args) => window.__TAURI_INTERNALS__!.invoke(cmd, args))
    : undefined
  await downloads?.initialize()

  async function cacheMediaPage(media: Media, episodes: Episode[]): Promise<void> {
    const hasLibraryEntry = !!(await store.get(media.id))
    const hasDownloads = !!downloads && (await downloads.list()).some((record) => record.media.id === media.id)
    if (!hasLibraryEntry && !hasDownloads) return

    const coverHash = media.coverUrl ? await sha256Hex(media.coverUrl) : undefined
    const previous = await mediaCache.get(media.id)
    await mediaCache.save(media.id, { media, episodes, coverHash })
    if (previous?.coverHash && previous.coverHash !== coverHash && native) {
      void removeCachedCoverIfUnreferenced(previous.coverHash)
    }
    if (media.coverUrl && native) {
      void window.__TAURI_INTERNALS__!.invoke('cache_cover_image', { args: { url: media.coverUrl } }).catch(() => {})
    }
  }

  async function cleanupMediaPage(mediaId: string): Promise<void> {
    const hasLibraryEntry = !!(await store.get(mediaId))
    const hasDownloads = !!downloads && (await downloads.list()).some((record) => record.media.id === mediaId)
    if (hasLibraryEntry || hasDownloads) return

    const page = await mediaCache.get(mediaId)
    await mediaCache.remove(mediaId)
    if (page?.coverHash && native) {
      void removeCachedCoverIfUnreferenced(page.coverHash)
    }
  }

  async function removeCachedCoverIfUnreferenced(fileHash: string): Promise<void> {
    const stillReferenced = (await mediaCache.list()).some((page) => page.coverHash === fileHash)
    if (stillReferenced) return
    await removeCachedCover(fileHash).catch(() => {})
  }

  async function removeCachedCover(fileHash: string): Promise<void> {
    await window.__TAURI_INTERNALS__!.invoke('remove_cached_cover', { args: { fileHash } })
  }

  for (const page of await mediaCache.list()) await cleanupMediaPage(page.media.id)

  return {
    engine,
    registry,
    store,
    plugins,
    downloads,
    mediaCache,
    cacheMediaPage,
    cleanupMediaPage,
    installed,
    setInstalled(id, version) {
      installed.set(id, version)
    },
    uninstall(id) {
      installed.delete(id)
      registry.unregister(id)
      engine.unregisterPlugin(id)
      sandboxes.get(id)?.terminate()
      sandboxes.delete(id)
      void plugins.remove(id)
    },
    setSourceEnabled,
    setPluginEnabled,
    getLandingSources: async () => (await prefs.get<string[]>('__app', 'landing.sources')) ?? [],
    setLandingSources: (ids: string[]) => prefs.set('__app', 'landing.sources', ids),
    getScrapeConfig: async () => getScrapeConfig(),
    setScrapeConfig: async (config) => {
      setScrapeConfig(config)
      await prefs.set('__app', 'scrape.url', config.url)
      await prefs.set('__app', 'scrape.token', config.token)
    },
    getSyncConfig: syncConfig,
    setSyncConfig: async (config) => {
      await prefs.set('__app', 'sync.server', config.server)
      await prefs.set('__app', 'sync.user', config.user)
      await prefs.set('__app', 'sync.token', config.token)
    },
    getAutoSyncEnabled: autoSyncEnabled,
    setAutoSyncEnabled: (enabled: boolean) => prefs.set('__app', 'autoSync.enabled', enabled),
    getLocale: async () => await prefs.get<LocaleId>('__app', 'locale'),
    setLocale: (locale: LocaleId) => prefs.set('__app', 'locale', locale),
    async installExternal(plugin) {
      const provider = createFetchProvider()
      const codeRes = await provider(plugin.url)
      if (codeRes.status < 200 || codeRes.status >= 300) throw new Error(`download ${plugin.url} -> HTTP ${codeRes.status}`)
      const code = codeRes.body
      if (code.length > MAX_PLUGIN_BYTES) {
        throw new Error(`plugin bundle too large: ${(code.length / 1024).toFixed(0)} KiB`)
      }

      const actual = await sha256Hex(code)
      if (actual !== plugin.sha256.toLowerCase()) {
        throw new Error(`sha256 mismatch for ${plugin.id}: expected ${plugin.sha256}, got ${actual}`)
      }

      const sandbox = await createSandbox(code)
      try {
        const manifest = validateManifest(sandbox.manifest)
        if (manifest.id !== plugin.id) throw new Error(`manifest id ${manifest.id} != ${plugin.id}`)

        // The sidecar manifest must agree with the bundle's embedded manifest.
        if (plugin.manifestUrl) {
          const mf = await provider(plugin.manifestUrl)
          if (mf.status < 200 || mf.status >= 300) throw new Error(`manifest ${plugin.manifestUrl} -> HTTP ${mf.status}`)
          const sidecar = validateManifest(JSON.parse(mf.body))
          if (
            sidecar.id !== manifest.id ||
            sidecar.version !== manifest.version ||
            sidecar.apiVersion !== manifest.apiVersion ||
            JSON.stringify(sidecar.sourceIds) !== JSON.stringify(manifest.sourceIds)
          ) {
            throw new Error(`sidecar manifest for ${plugin.id} does not match the bundle`)
          }
        }

        engine.unregisterPlugin(plugin.id)
        sandboxes.get(plugin.id)?.terminate()
        registerPlugin(sandbox, 'external')
        installed.set(plugin.id, plugin.version)

        await plugins.save({ id: plugin.id, code, sha256: actual, manifest })
      } catch (e) {
        sandbox.terminate()
        throw e
      }
    }
  }
}
