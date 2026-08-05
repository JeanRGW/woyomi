import type { Media } from '@media-platform/core'
import { navigate } from './App'

export function MediaCard({ media }: { media: Media }) {
  const [srcId, mediaId] = media.id.split('/')
  return (
    <div className="card" onClick={() => navigate({ name: 'media', sourceId: srcId!, mediaId: mediaId! })} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'media', sourceId: srcId!, mediaId: mediaId! })}>
      {media.coverUrl ? <img className="cover" src={media.coverUrl} alt="" loading="lazy" /> : <div className="cover placeholder">{media.type.slice(0, 1).toUpperCase()}</div>}
      <div className="card-body">
        <div className="card-title">{media.title}</div>
        <div className="card-meta">
          {media.type}
          {media.status ? ` · ${media.status}` : ''}
        </div>
      </div>
    </div>
  )
}

export function EpisodeRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <div className={`episode-row ${active ? 'seen' : ''}`} role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <span>{label}</span>
      {active && <span className="badge">seen</span>}
    </div>
  )
}
