import { useEffect, useState } from 'react'
import type { ChapterContent } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import { useRecordOpenById } from '../hooks'
import { BackButton, Banner, Page } from '../components'

export function ReaderView({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  const [content, setContent] = useState<ChapterContent | null>(null)
  const [error, setError] = useState('')

  useRecordOpenById(runtime, sourceId, mediaId, episodeId)

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

  if (error)
    return (
      <Page>
        <BackButton />
        <Banner tone="error">{error}</Banner>
      </Page>
    )
  if (!content)
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-muted">Loading chapter…</p>
      </div>
    )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 md:py-8">
      <div className="sticky top-3 z-10">
        <BackButton />
      </div>
      {content.type === 'pages' ? (
        <div className="flex flex-col items-center gap-1.5">
          {content.images.map((src, i) => (
            <img key={i} src={src} alt={`page ${i + 1}`} loading="lazy" className="max-w-full rounded-md" />
          ))}
        </div>
      ) : (
        <article className="novel-body" dangerouslySetInnerHTML={{ __html: content.html }} />
      )}
    </div>
  )
}
