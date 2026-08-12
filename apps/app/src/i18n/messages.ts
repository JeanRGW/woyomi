import { isVideoType, type LibraryStatus, type MediaStatus, type MediaType } from '@woyomi/core'
import { pt } from './pt'

/**
 * Flat message keys, prefix-grouped by view/area. `en` defines the canonical
 * key set; `Messages` is the shape every locale must satisfy (typed full
 * coverage). Add a locale by adding `{ id, catalog }` to `messages`.
 */
const en = {
    // navigation
    'nav.browse': 'Browse',
    'nav.library': 'Library',
    'nav.history': 'History',
    'nav.plugins': 'Plugins',
    'nav.settings': 'Settings',

    // shared
    'common.back': 'Back',
    'common.loading': 'Loading…',
    'common.loadingEngine': 'Loading engine…',
    'common.loadingChapter': 'Loading chapter…',
    'common.more': 'More',
    'common.refresh': 'Refresh',
    'common.refreshing': 'Refreshing…',
    'common.saved': 'Saved',
    'common.ok': 'OK',
    'common.failed': 'Failed',
    'common.testing': 'Testing…',
    'common.close': 'Close',
    'common.reload': 'Reload',
    'common.errorTitle': 'Something went wrong',
    'common.seen': 'seen',
    'common.markSeen': 'Mark seen',
    'common.markUnseen': 'Mark unseen',
    'common.native': 'native',
    'common.episode': 'Episode {number}',
    'common.chapter': 'Chapter {number}',
    'common.season': ' · S{season}',
    'common.title': ' — {title}',

    // media types
    'type.manga': 'manga',
    'type.anime': 'anime',
    'type.novel': 'novel',
    'type.movie': 'movie',
    'type.series': 'series',

    // library status / publication status
    'status.reading': 'reading',
    'status.watching': 'watching',
    'status.plan': 'plan',
    'status.planToWatch': 'plan to watch',
    'status.completed': 'completed',
    'status.dropped': 'dropped',
    'status.paused': 'paused',
    'status.onHold': 'on hold',
    'status.ongoing': 'ongoing',
    'status.hiatus': 'hiatus',
    'status.cancelled': 'cancelled',

    // browse
    'browse.home': 'Home',
    'browse.search': 'Search',
    'browse.allSources': 'All sources',
    'browse.singleSource': 'Single source',
    'browse.searchPlaceholder': 'Search titles…',
    'browse.searching': 'Searching…',
    'browse.searchEmptyTitle': 'Search every source at once',
    'browse.searchEmptyHint': 'Results are grouped per source. Pick a single source for paged results.',
    'browse.homeEmptyTitle': 'Your home is empty',
    'browse.homeEmptyHint': 'Pin a source below and its sections will land here.',
    'browse.noHomeSources': 'No sources expose a homepage.',
    'browse.pin': 'Pin',
    'browse.unpin': 'Unpin',
    'browse.loadMore': 'Load more',
    'browse.loadMoreFrom': 'Load more from {name}',

    // library
    'library.all': 'All',
    'library.emptyTitle': 'Nothing here yet',
    'library.emptyHint': 'Add titles from Browse and they will show up in your library.',

    // media detail
    'media.addToLibrary': 'Add to library…',
    'media.remove': 'Remove',
    'media.removeFromLibrary': 'Remove from library',
    'media.episodeCount': '{count} episodes',
    'media.episodeCount.one': '{count} episode',
    'media.chapterCount': '{count} chapters',
    'media.chapterCount.one': '{count} chapter',
    'media.markAllSeen': 'Mark all seen',
    'media.markAllUnseen': 'Mark all unseen',

    // history
    'history.emptyTitle': 'Nothing watched or read yet',
    'history.emptyHint': 'Open a chapter or video and it will land here.',
    'history.resume': 'Resume',
    'history.remove': 'Remove from history',

    // plugin store
    'store.addRepo': 'Add repo',
    'store.addRepoPlaceholder': 'Add repo URL (e.g. https://host/plugins)',
    'store.removeRepo': 'Remove repo {url}',
    'store.available': 'Available',
    'store.emptyTitle': 'No plugins found',
    'store.emptyHint': 'Add a plugin repository URL above to discover installable sources.',
    'store.nsfw': 'NSFW',
    'store.installed': 'Installed',
    'store.update': 'Update ({version})',
    'store.install': 'Install',
    'store.installedMessage': 'Installed {name} {version}',

    // settings
    'settings.plugins': 'Plugins',
    'settings.uninstall': 'Uninstall',
    'settings.enable': 'Enable {name}',
    'settings.disable': 'Disable {name}',
    'settings.pluginSettings': 'Plugin settings',
    'settings.pluginOptions': 'Options from {count} plugins',
    'settings.pluginOptions.one': 'Options from {count} plugin',
    'settings.pluginOptionsGeneric': 'Per-source toggles and plugin options',
    'settings.webProxy': 'Web proxy (scrape)',
    'settings.webProxyHint': "Used in the browser build to fetch sources that don't allow CORS (e.g. HTML scrapers). Leave the URL empty to use direct fetch. Point it at a self-hosted server with ",
    'settings.webProxyHintCode': 'SCRAPE_ENABLED=true',
    'settings.webProxyHintEnd': '.',
    'settings.proxyUrl': 'Proxy server URL',
    'settings.proxyKey': 'Proxy key',
    'settings.proxyKeyPlaceholder': 'Key (optional, matches SCRAPE_TOKEN)',
    'settings.saveProxy': 'Save proxy',
    'settings.testConnection': 'Test connection',
    'settings.librarySync': 'Library sync',
    'settings.syncHint': 'Sync library, progress, and history with a self-hosted woyomi server.',
    'settings.syncServer': 'Sync server URL',
    'settings.syncUser': 'Sync user',
    'settings.syncUserPlaceholder': 'User',
    'settings.syncToken': 'Sync token',
    'settings.syncTokenPlaceholder': 'Token',
    'settings.saveSync': 'Save sync',
    'settings.push': 'Push now',
    'settings.pull': 'Pull now',
    'settings.autoSyncOn': 'Auto-sync on',
    'settings.autoSyncOff': 'Auto-sync off',
    'settings.syncOnOpen': 'Syncs on app open and after each library change',
    'settings.syncManual': 'Syncing manually only',
    'settings.syncing': 'Syncing…',
    'settings.data': 'Data',
    'settings.exportLibrary': 'Export library',
    'settings.importLibrary': 'Import library',
    'settings.enterServerUrl': 'Enter a server URL first',
    'settings.enterServerAndUser': 'Enter a server URL and user first',
    'settings.language': 'Language',
    'settings.lang.en': 'English',
    'settings.lang.pt': 'Português',

    // plugin settings
    'pluginSettings.title': 'Plugin settings',
    'pluginSettings.subtitle': 'Every option exposed by your installed plugins, in one place.',
    'pluginSettings.emptyTitle': 'Nothing to configure',
    'pluginSettings.emptyHint': 'Installed plugins do not expose any settings yet.',
    'pluginSettings.sources': 'Sources',

    // player
    'player.playing': 'Playing…',
    'player.episodeNotFound': 'Episode not found',
    'player.noStreams': 'No playable streams returned.',

    // reader
    'reader.emptyChapter': 'This chapter has no viewable content.',
    'reader.chapters': 'Chapters',
    'reader.readerSettings': 'Reader settings',
    'reader.strip': 'Strip',
    'reader.pages': 'Pages',
    'reader.prevChapter': 'Previous chapter',
    'reader.nextChapter': 'Next chapter',
    'reader.zoomIn': 'Zoom in',
    'reader.zoomOut': 'Zoom out',
    'reader.resetZoom': 'Reset zoom',
    'reader.readingMode': 'Reading mode',
    'reader.direction': 'Direction',
    'reader.rightToLeft': 'Right to left',
    'reader.leftToRight': 'Left to right',
    'reader.vertical': 'Vertical',
    'reader.fit': 'Fit',
    'reader.fitScreen': 'Fit screen',
    'reader.fitWidth': 'Fit width',
    'reader.background': 'Background',
    'reader.ink': 'Ink',
    'reader.black': 'Black',
    'reader.sepia': 'Sepia',
    'reader.tapToNavigate': 'Tap to navigate',
    'reader.stripWidth': 'Strip width',
    'reader.doublePage': 'Double page',
    'reader.autoAdvance': 'Auto-advance to next chapter',
    'reader.pageFailed': 'Page failed to load',
    'reader.tapToRetry': 'Tap to retry',
    'reader.pageAlt': 'page {number}'
} as const

export const messages = { en, pt } as const

export type LocaleId = keyof typeof messages
export type MessageKey = keyof typeof en

/** The shape a locale catalog must satisfy (used by future locale files). */
export type Messages = Record<MessageKey, string>

/** Looks up a message, falling back to English for missing locale/key. */
export function translate(locale: LocaleId, key: MessageKey, params?: Record<string, string | number>): string {
  const table = messages[locale] ?? messages.en
  let text: string = table[key]
  // Plural: the base key is the "other" form; `key.one` overrides for count === 1.
  if (params?.count === 1) {
    const oneKey = `${key}.one` as MessageKey
    if (oneKey in table) text = table[oneKey]
  }
  if (params) {
    // Numbers use the locale's formatting (e.g. pt-BR "1.000", not "1000").
    const formatNumber = new Intl.NumberFormat(locale)
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, typeof value === 'number' ? formatNumber.format(value) : value)
    }
  }
  return text
}

const LIBRARY_STATUS_KEY: Record<LibraryStatus, { read: MessageKey; video: MessageKey }> = {
  reading: { read: 'status.reading', video: 'status.watching' },
  plan: { read: 'status.plan', video: 'status.planToWatch' },
  completed: { read: 'status.completed', video: 'status.completed' },
  dropped: { read: 'status.dropped', video: 'status.dropped' },
  paused: { read: 'status.paused', video: 'status.onHold' }
}

export function libraryStatusLabelKey(status: LibraryStatus, mediaType: MediaType): MessageKey {
  return isVideoType(mediaType) ? LIBRARY_STATUS_KEY[status].video : LIBRARY_STATUS_KEY[status].read
}

/** Library filter chips have no single media type, so they use the reading wording. */
export function libraryStatusFilterKey(status: LibraryStatus): MessageKey {
  return LIBRARY_STATUS_KEY[status].read
}

const MEDIA_STATUS_KEY: Record<MediaStatus, MessageKey> = {
  ongoing: 'status.ongoing',
  completed: 'status.completed',
  hiatus: 'status.hiatus',
  cancelled: 'status.cancelled'
}

export function mediaStatusLabelKey(status: MediaStatus): MessageKey {
  return MEDIA_STATUS_KEY[status]
}

export const MEDIA_TYPE_KEY: Record<MediaType, MessageKey> = {
  manga: 'type.manga',
  anime: 'type.anime',
  novel: 'type.novel',
  movie: 'type.movie',
  series: 'type.series'
}

export function mediaTypeLabelKey(type: MediaType): MessageKey {
  return MEDIA_TYPE_KEY[type]
}

/** Self-named locale label (e.g. "English" stays English in every catalog). */
const LOCALE_NAME_KEY: Record<LocaleId, MessageKey> = {
  en: 'settings.lang.en',
  pt: 'settings.lang.pt'
}

export function localeNameKey(locale: LocaleId): MessageKey {
  return LOCALE_NAME_KEY[locale]
}
