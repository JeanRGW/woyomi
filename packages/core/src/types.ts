export type MediaType = 'manga' | 'anime' | 'novel' | 'movie' | 'series'

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

export interface SourceContext {
  fetch: FetchFn
  cache: CacheApi
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
}

export interface PluginRegistration {
  manifest: PluginManifest
  sources: Source[]
}

export interface LibraryEntry {
  media: Media
  status: LibraryStatus
  addedAt: number
}

export interface ProgressEntry {
  mediaId: string
  seenEpisodeIds: string[]
  updatedAt: number
}

export interface LibraryStore {
  add(media: Media, status: LibraryStatus): Promise<void>
  updateStatus(mediaId: string, status: LibraryStatus): Promise<void>
  remove(mediaId: string): Promise<void>
  get(mediaId: string): Promise<LibraryEntry | undefined>
  list(): Promise<LibraryEntry[]>
  setSeen(mediaId: string, episodeId: string): Promise<void>
  setSeenMany(mediaId: string, episodeIds: string[]): Promise<void>
  getProgress(mediaId: string): Promise<ProgressEntry | undefined>
  exportJson(): Promise<string>
  importJson(json: string): Promise<void>
}
