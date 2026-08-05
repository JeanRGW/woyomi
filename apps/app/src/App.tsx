import { useEffect, useState } from 'react'
import { getRuntime, isTauri, type AppRuntime } from './runtime'
import { BrowseView } from './views/BrowseView'
import { HistoryView } from './views/HistoryView'
import { LibraryView } from './views/LibraryView'
import { MediaView } from './views/MediaView'
import { ReaderView } from './views/ReaderView'
import { PlayerView } from './views/PlayerView'
import { StoreView } from './views/StoreView'
import { SettingsView } from './views/SettingsView'
import { PluginSettingsView } from './views/PluginSettingsView'
import { Icon, type IconName } from './icons'

export type Route =
  | { name: 'browse' }
  | { name: 'library' }
  | { name: 'history' }
  | { name: 'media'; sourceId: string; mediaId: string }
  | { name: 'reader'; sourceId: string; mediaId: string; episodeId: string }
  | { name: 'player'; sourceId: string; mediaId: string; episodeId: string }
  | { name: 'store' }
  | { name: 'settings' }
  | { name: 'plugin-settings' }

function parseHash(hash: string): Route {
  const [path, ...rest] = hash.replace(/^#\/?/, '').split('/')
  switch (path) {
    case 'media':
      return { name: 'media', sourceId: rest[0] ?? '', mediaId: rest.slice(1).join('/') }
    case 'reader':
      return { name: 'reader', sourceId: rest[0] ?? '', mediaId: rest[1] ?? '', episodeId: rest.slice(2).join('/') }
    case 'player':
      return { name: 'player', sourceId: rest[0] ?? '', mediaId: rest[1] ?? '', episodeId: rest.slice(2).join('/') }
    case 'store':
      return { name: 'store' }
    case 'settings':
      return rest[0] === 'plugins' ? { name: 'plugin-settings' } : { name: 'settings' }
    case 'history':
      return { name: 'history' }
    case 'browse':
      return { name: 'browse' }
    case 'library':
    default:
      return { name: 'library' }
  }
}

export function navigate(route: Route): void {
  const path =
    route.name === 'browse'
      ? '#/browse'
      : route.name === 'library'
        ? '#/library'
        : route.name === 'history'
          ? '#/history'
          : route.name === 'store'
            ? '#/store'
            : route.name === 'settings'
              ? '#/settings'
              : route.name === 'plugin-settings'
                ? '#/settings/plugins'
                : `#/${route.name}/${route.sourceId}/${route.mediaId}${route.name === 'reader' || route.name === 'player' ? `/${route.episodeId}` : ''}`
  window.location.hash = path
}

const tabs: Array<{ route: Route; label: string; icon: IconName }> = [
  { route: { name: 'browse' }, label: 'Browse', icon: 'browse' },
  { route: { name: 'library' }, label: 'Library', icon: 'library' },
  { route: { name: 'history' }, label: 'History', icon: 'history' },
  { route: { name: 'store' }, label: 'Plugins', icon: 'plugins' },
  { route: { name: 'settings' }, label: 'Settings', icon: 'settings' }
]

function isActive(route: Route, tab: Route): boolean {
  if (tab.name === 'settings') return route.name === 'settings' || route.name === 'plugin-settings'
  return route.name === tab.name
}

export function App() {
  const [runtime, setRuntime] = useState<AppRuntime | null>(null)
  const [route, setRoute] = useState<Route>(parseHash(window.location.hash))

  useEffect(() => {
    getRuntime().then(setRuntime)
  }, [])

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!runtime) {
    return (
      <div className="grid h-full place-items-center bg-ink">
        <div className="flex flex-col items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent-deep shadow-lg shadow-accent/25">
            <Icon name="library" size={24} className="text-white" />
          </div>
          <p className="text-sm text-muted">Loading engine…</p>
        </div>
      </div>
    )
  }

  const bare = route.name === 'media' || route.name === 'reader' || route.name === 'player'

  return (
    <div className="flex h-full bg-ink text-fg">
      {!bare && (
        <aside className="hidden w-60 shrink-0 flex-col border-r border-line-soft bg-surface/30 md:flex">
          <div className="flex items-center gap-3 px-5 pb-6 pt-6">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-md shadow-accent/25">
              <Icon name="library" size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-extrabold tracking-tight">Media Platform</div>
              <div className="text-[11px] font-medium text-faint">multi-source library</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1 px-3">
            {tabs.map((t) => (
              <button
                key={t.label}
                onClick={() => navigate(t.route)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                  isActive(route, t.route) ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`}
              >
                <Icon name={t.icon} size={19} />
                {t.label}
              </button>
            ))}
          </nav>
          {isTauri() && (
            <div className="mt-auto px-5 pb-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                <span className="size-1.5 rounded-full bg-ok" />
                native
              </span>
            </div>
          )}
        </aside>
      )}

      <main className={`min-w-0 flex-1 overflow-y-auto ${bare ? '' : 'pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0'}`}>
        <Content route={route} runtime={runtime} />
      </main>

      {!bare && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line-soft bg-surface/85 backdrop-blur-md md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="grid grid-cols-5">
            {tabs.map((t) => (
              <button
                key={t.label}
                onClick={() => navigate(t.route)}
                className={`flex flex-col items-center gap-1 py-2 text-[10px] font-bold transition-colors ${
                  isActive(route, t.route) ? 'text-accent' : 'text-muted'
                }`}
              >
                <Icon name={t.icon} size={21} />
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

function Content({ route, runtime }: { route: Route; runtime: AppRuntime }) {
  switch (route.name) {
    case 'browse':
      return <BrowseView runtime={runtime} />
    case 'history':
      return <HistoryView runtime={runtime} />
    case 'library':
      return <LibraryView runtime={runtime} />
    case 'media':
      return <MediaView runtime={runtime} sourceId={route.sourceId} mediaId={route.mediaId} />
    case 'reader':
      return <ReaderView runtime={runtime} sourceId={route.sourceId} mediaId={route.mediaId} episodeId={route.episodeId} />
    case 'player':
      return <PlayerView runtime={runtime} sourceId={route.sourceId} mediaId={route.mediaId} episodeId={route.episodeId} />
    case 'store':
      return <StoreView runtime={runtime} />
    case 'settings':
      return <SettingsView runtime={runtime} />
    case 'plugin-settings':
      return <PluginSettingsView runtime={runtime} />
  }
}
