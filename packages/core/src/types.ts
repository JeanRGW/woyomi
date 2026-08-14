export type MediaType = 'manga' | 'anime' | 'novel' | 'movie' | 'series'

export const VIDEO_TYPES: readonly MediaType[] = ['anime', 'movie', 'series']

/** Media whose episodes are played as video rather than read. */
export function isVideoType(type: MediaType): boolean {
  return VIDEO_TYPES.includes(type)
}

export type MediaStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled'

export type LibraryStatus = 'reading' | 'plan' | 'completed' | 'dropped' | 'paused'

export type StreamKind = 'hls' | 'mp4'

export interface Media {
  /** globally unique: `${sourceId}/${mediaId}` */
  id: string
  title: string
  altTitles?: string[]
  type: MediaType
  status?: MediaStatus
  coverUrl?: string
  synopsis?: string
  tags?: string[]
  /** plain media id as known by the source */
  mediaId: string
  sourceId: string
}

export interface Episode {
  /** `${sourceId}/${mediaId}/${episodeId}` */
  id: string
  /** episode/chapter number (a movie has 1) */
  number: number
  /** season for series/anime; undefined otherwise */
  season?: number
  title?: string
  publishedAt?: string
  /** per-episode artwork (anime) */
  imageUrl?: string
  /** language/locale this episode's content is in (video/read sources) */
  lang?: string
  mediaId: string
}

export type ChapterContent =
  | { type: 'pages'; images: string[] }
  | { type: 'text'; html: string }

export interface StreamSource {
  url: string
  kind: StreamKind
  quality?: string
  headers?: Record<string, string>
}

export interface SearchResults {
  page: number
  hasNextPage: boolean
  items: Media[]
}

/** A discovery section on a source's homepage (e.g. Latest, Top). */
export interface HomeSection {
  id: string
  title: string
}

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** 'dom' loads the page with JS in a browser-like env and returns serialized HTML */
  mode?: 'text' | 'dom'
}

export interface FetchResult {
  status: number
  headers: Record<string, string>
  body: string
}

/** Network access is injected, never called directly by plugins. */
export type FetchFn = (url: string, init?: FetchInit) => Promise<FetchResult>

export interface CacheApi {
  withCache<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T>
}

/** Source-scoped settings; persisted by the store. Values are scalars/arrays. */
export type PreferenceValue = string | number | boolean | (string | number | boolean)[]

export interface PreferencesApi {
  get<T extends PreferenceValue>(pluginId: string, key: string): Promise<T | undefined>
  /** Reads the persisted value or `fallback` when unset; never throws. */
  getWithDefault<T extends PreferenceValue>(pluginId: string, key: string, fallback: T): Promise<T>
  set(pluginId: string, key: string, value: PreferenceValue): Promise<void>
}

/**
 * Plugin-scoped preferences: the engine binds these to the plugin that owns the
 * current source, so a plugin reads/writes settings by key without knowing its
 * own id. Persisted keyed by plugin id by the store backend.
 */
export interface SourcePrefs {
  get<T extends PreferenceValue>(key: string): Promise<T | undefined>
  getWithDefault<T extends PreferenceValue>(key: string, fallback: T): Promise<T>
  set(key: string, value: PreferenceValue): Promise<void>
}

/** A setting a plugin exposes in the Settings UI. */
export interface SourcePref {
  key: string
  label: string
  type: 'boolean' | 'select' | 'string' | 'multi'
  defaultValue?: string | boolean | string[]
  options?: { value: string; label: string }[]
  description?: string
}

export interface SourceContext {
  fetch: FetchFn
  cache: CacheApi
  preferences: SourcePrefs
}

export interface Source {
  id: string
  name: string
  mediaTypes: MediaType[]
  lang?: string
  search(ctx: SourceContext, query: string, page: number): Promise<SearchResults>
  getMedia(ctx: SourceContext, mediaId: string): Promise<Media>
  getEpisodes(ctx: SourceContext, mediaId: string): Promise<Episode[]>
  getChapterContent(ctx: SourceContext, mediaId: string, episodeId: string): Promise<ChapterContent>
  getStreams?(ctx: SourceContext, media: Media, episode: Episode): Promise<StreamSource[]>
  /** optional homepage discovery sections (e.g. Latest, Top); if present, getHomeSection must be too */
  getHomeSections?(ctx: SourceContext): Promise<HomeSection[]>
  getHomeSection?(ctx: SourceContext, sectionId: string, page: number): Promise<SearchResults>
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  /** must equal API_VERSION at runtime or the plugin is rejected */
  apiVersion: number
  lang?: string
  nsfw?: boolean
  description?: string
  mediaTypes: MediaType[]
  /** file name of the executable bundle inside the plugin directory */
  entry: string
  sourceIds: string[]
  /** settings exposed in the Settings UI, keyed by plugin on the store */
  prefs?: SourcePref[]
}

export interface PluginRegistration {
  manifest: PluginManifest
  sources: Source[]
}

export interface LibraryEntry {
  media: Media
  status: LibraryStatus
  addedAt: number
  /** last mutation time; defaults to `addedAt` for legacy rows; used for sync merge */
  updatedAt?: number
}

/** Locally cached title metadata for offline media-page access. Never synced. */
export interface CachedMediaPage {
  media: Media
  episodes: Episode[]
  /** sha256 hex of the remote cover URL; never a process-local loopback URL. */
  coverHash?: string
}

export interface MediaPageCache {
  list(): Promise<CachedMediaPage[]>
  get(mediaId: string): Promise<CachedMediaPage | undefined>
  save(mediaId: string, page: CachedMediaPage): Promise<void>
  remove(mediaId: string): Promise<void>
}

/** A deleted id + when it was deleted, carried so other devices don't resurrect it. */
export interface SyncTombstone {
  id: string
  deletedAt: number
}

export interface SyncEdits {
  entries: SyncTombstone[]
  progress: SyncTombstone[]
  history: SyncTombstone[]
}

/** The library payload exchanged with the sync server (union of full JSON export + tombstones). */
export interface SyncPayload {
  version: number
  entries: LibraryEntry[]
  progress: ProgressEntry[]
  history: HistoryEntry[]
  tombstones: SyncEdits
}

export interface ProgressEntry {
  mediaId: string
  seenEpisodeIds: string[]
  updatedAt: number
}

/** One opened chapter/video/other: media + episode snapshot, keyed mediaId/episodeId. */
export interface HistoryEntry {
  media: Media
  episode: Episode
  openedAt: number
}

/** An externally-installed plugin persisted for rehydration across restarts. */
export interface PluginStoredBundle {
  /** plugin id */
  id: string
  /** the code bundle as a self-contained IIFE string */
  code: string
  /** sha256 hex of `code`, verified at install time */
  sha256: string
  /** plugin manifest (mirrors what loadBundle returns) */
  manifest: PluginManifest
}

export interface PluginStore {
  list(): Promise<PluginStoredBundle[]>
  /** Returns the previously stored bundle for this id, if any. */
  get(id: string): Promise<PluginStoredBundle | undefined>
  save(bundle: PluginStoredBundle): Promise<void>
  remove(id: string): Promise<void>
}

export interface LibraryStore {
  add(media: Media, status: LibraryStatus): Promise<void>
  updateStatus(mediaId: string, status: LibraryStatus): Promise<void>
  remove(mediaId: string): Promise<void>
  get(mediaId: string): Promise<LibraryEntry | undefined>
  list(): Promise<LibraryEntry[]>
  setSeen(mediaId: string, episodeId: string): Promise<void>
  setSeenMany(mediaId: string, episodeIds: string[]): Promise<void>
  unsetSeen(mediaId: string, episodeId: string): Promise<void>
  unsetSeenMany(mediaId: string, episodeIds: string[]): Promise<void>
  getProgress(mediaId: string): Promise<ProgressEntry | undefined>
  /** Upsert an open into history; re-opening dedupes and bumps openedAt. */
  addHistory(media: Media, episode: Episode): Promise<void>
  /** Most-recently-opened first. */
  listHistory(): Promise<HistoryEntry[]>
  /** episodeId is globally unique, so mediaId is not needed. */
  removeHistory(episodeId: string): Promise<void>
  exportJson(): Promise<string>
  importJson(json: string): Promise<void>
}
