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

export type Route =
  | { name: 'browse' }
  | { name: 'library' }
  | { name: 'history' }
  | { name: 'media'; sourceId: string; mediaId: string }
  | { name: 'reader'; sourceId: string; mediaId: string; episodeId: string }
  | { name: 'player'; sourceId: string; mediaId: string; episodeId: string }
  | { name: 'store' }
  | { name: 'settings' }

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
      return { name: 'settings' }
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
              : `#/${route.name}/${route.sourceId}/${route.mediaId}${route.name === 'reader' || route.name === 'player' ? `/${route.episodeId}` : ''}`
  window.location.hash = path
}

const tabs: Array<{ route: Route; label: string }> = [
  { route: { name: 'browse' }, label: 'Browse' },
  { route: { name: 'library' }, label: 'Library' },
  { route: { name: 'history' }, label: 'History' },
  { route: { name: 'store' }, label: 'Plugins' },
  { route: { name: 'settings' }, label: 'Settings' }
]

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

  if (!runtime) return <div className="page center">Loading engine…</div>

  return (
    <div className="app">
      {route.name === 'media' || route.name === 'reader' || route.name === 'player' ? (
        <Content route={route} runtime={runtime} />
      ) : (
        <>
          <nav className="nav">
            {tabs.map((t) => (
              <button key={t.label} className={`nav-btn ${route.name === t.route.name ? 'active' : ''}`} onClick={() => navigate(t.route)}>
                {t.label}
              </button>
            ))}
            {isTauri() && <span className="nav-badge">native</span>}
          </nav>
          <Content route={route} runtime={runtime} />
        </>
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
  }
}
