import { useEffect, useState } from 'react'
import type { ChapterContent } from '@media-platform/core'
import type { AppRuntime } from '../runtime'

export function ReaderView({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  const [content, setContent] = useState<ChapterContent | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    runtime.engine
      .getChapterContent(sourceId, mediaId, episodeId)
      .then((c) => !cancelled && setContent(c))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [runtime, sourceId, mediaId, episodeId])

  if (error) return <div className="view"><div className="error">{error}</div></div>
  if (!content) return <div className="view center">Loading chapter…</div>

  return (
    <div className="view reader">
      <button className="back" onClick={() => history.back()}>← Back</button>
      {content.type === 'pages' ? (
        <div className="pages">
          {content.images.map((src, i) => (
            <img key={i} src={src} alt={`page ${i + 1}`} loading="lazy" />
          ))}
        </div>
      ) : (
        <article className="novel" dangerouslySetInnerHTML={{ __html: content.html }} />
      )}
    </div>
  )
}
