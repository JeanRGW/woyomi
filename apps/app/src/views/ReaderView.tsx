import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterContent, Episode, Media } from '@media-platform/core'
import type { AppRuntime } from '../runtime'
import { navigate } from '../App'
import { useRecordOpenById } from '../hooks'
import { BackButton, Banner, Page } from '../components'
import { findAdjacent, restorePage, viewLabel, type PageView } from './reader/reader-nav'
import { BACKGROUNDS, getReadPosition, saveReadPosition, useReaderPrefs } from './reader/reader-prefs'
import { PagedReader, type ZoomClusterState } from './reader/PagedReader'
import { ContinuousReader } from './reader/ContinuousReader'
import { ReaderChrome } from './reader/ReaderChrome'
import { ChapterDrawer, ReaderSettingsSheet } from './reader/ReaderSettings'

export function ReaderView({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  return <ReaderSession key={episodeId} runtime={runtime} sourceId={sourceId} mediaId={mediaId} episodeId={episodeId} />
}

function ReaderSession({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  const [content, setContent] = useState<ChapterContent | null>(null)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<Media | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [seen, setSeen] = useState<Set<string>>(new Set())

  const { prefs, loaded: prefsLoaded, set: setPref } = useReaderPrefs(runtime.engine.prefs)
  const [initialPage, setInitialPage] = useState<number | null>(null)
  const [view, setView] = useState<PageView>({ start: 0, count: 1, readingStart: 0, readingEnd: 0 })
  const [chromeVisible, setChromeVisible] = useState(false)
  const [sheet, setSheet] = useState<'none' | 'settings' | 'chapters'>('none')
  const [zoomCtl, setZoomCtl] = useState<ZoomClusterState | null>(null)

  const autoAdvanceFired = useRef(false)

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

  // chrome/nav context — non-fatal
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [m, eps, prog] = await Promise.all([
          runtime.engine.getMedia(sourceId, mediaId),
          runtime.engine.getEpisodes(sourceId, mediaId),
          runtime.store.getProgress(`${sourceId}/${mediaId}`)
        ])
        if (cancelled) return
        setMedia(m)
        setEpisodes(eps)
        setSeen(new Set(prog?.seenEpisodeIds ?? []))
      } catch {
        // titles/chapter nav just stay minimal
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runtime, sourceId, mediaId, episodeId])

  const total = content?.type === 'pages' ? content.images.length : 0

  // restore position once prefs + pages are known
  useEffect(() => {
    if (!prefsLoaded || total === 0 || initialPage !== null) return
    let cancelled = false
    getReadPosition(runtime.engine.prefs, episodeId).then((saved) => {
      if (!cancelled) setInitialPage(restorePage(saved, total))
    })
    return () => {
      cancelled = true
    }
  }, [runtime, prefsLoaded, total, initialPage, sourceId, mediaId, episodeId])

  const prevEpisode = findAdjacent(episodes, episodeId, -1)
  const nextEpisode = findAdjacent(episodes, episodeId, 1)

  // in-reader chapter jumps replace history so Back returns to the media page
  const jumpTo = useCallback(
    (ep: Episode) => navigate({ name: 'reader', sourceId, mediaId, episodeId: ep.id }, { replace: true }),
    [sourceId, mediaId]
  )

  // position save + finish + auto-advance
  const finished = total > 0 && view.readingEnd === total - 1
  useEffect(() => {
    if (total === 0 || initialPage === null) return
    saveReadPosition(runtime.engine.prefs, episodeId, finished ? total : view.readingStart)
    if (finished && prefs.autoNext && nextEpisode && !autoAdvanceFired.current) {
      autoAdvanceFired.current = true
      jumpTo(nextEpisode)
    }
  }, [runtime, sourceId, mediaId, episodeId, finished, view.readingStart, total, initialPage, prefs.autoNext, nextEpisode, jumpTo])

  if (error)
    return (
      <Page>
        <BackButton />
        <Banner tone="error">{error}</Banner>
      </Page>
    )

  if (!content || (content.type === 'pages' && initialPage === null)) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-muted">Loading chapter…</p>
      </div>
    )
  }

  const isImages = content.type === 'pages'
  const empty = isImages ? total === 0 : !content.html.trim()
  const chapter = episodes.find((e) => e.id === episodeId)
  const chapterLabel = chapter
    ? `Chapter ${chapter.number}${chapter.season != null ? ` · S${chapter.season}` : ''}${chapter.title ? ` — ${chapter.title}` : ''}`
    : ''
  const continuousView = { start: view.start, count: 1 as const, readingStart: view.start, readingEnd: view.start }
  const labelView = prefs.mode === 'paged' ? view : continuousView
  // strip mode is always vertical; pages mode is rtl/ltr (stored value may be
  // stale from the other mode, so coerce here too)
  const pagedDirection = prefs.direction === 'vertical' ? 'rtl' : prefs.direction

  return (
    <div className="relative h-full min-h-0 overflow-hidden" style={{ backgroundColor: BACKGROUNDS[prefs.background] }}>
      {empty ? (
        <div className="grid h-full place-items-center px-4">
          <p className="mx-auto max-w-md py-10 text-center text-sm text-muted">This chapter has no viewable content.</p>
        </div>
      ) : isImages ? (
        prefs.mode === 'paged' ? (
          <PagedReader
            images={content.images}
            direction={pagedDirection}
            fit={prefs.fit}
            doublePage={prefs.doublePage}
            tapNav={prefs.tapNav}
            initialPage={initialPage ?? 0}
            onViewChange={setView}
            onToggleChrome={() => setChromeVisible((v) => !v)}
            onZoomChange={setZoomCtl}
          />
        ) : (
          <ContinuousReader
            images={content.images}
            stripWidth={prefs.stripWidth}
            initialPage={initialPage ?? 0}
            onViewChange={setView}
            onToggleChrome={() => setChromeVisible((v) => !v)}
          />
        )
      ) : (
        <div className="h-full overflow-y-auto" onClick={() => setChromeVisible((v) => !v)}>
          <article className="novel-body mx-auto max-w-3xl px-4 py-12" dangerouslySetInnerHTML={{ __html: content.html }} />
        </div>
      )}

      <ReaderChrome
        visible={chromeVisible}
        title={media?.title ?? ''}
        chapterLabel={chapterLabel}
        isImages={isImages && !empty}
        mode={prefs.mode}
        onModeToggle={() => {
          // direction is per-mode: strip = vertical, pages = rtl/ltr
          const nextMode = prefs.mode === 'continuous' ? 'paged' : 'continuous'
          const nextDirection = nextMode === 'paged' ? (prefs.direction === 'vertical' ? 'rtl' : prefs.direction) : 'vertical'
          if (nextDirection !== prefs.direction) setPref('direction', nextDirection)
          setPref('mode', nextMode)
        }}
        onOpenChapters={() => setSheet('chapters')}
        onOpenSettings={() => setSheet('settings')}
        progress={isImages && total > 0 ? (labelView.readingEnd + 1) / total : 0}
        pageLabel={isImages && total > 0 ? viewLabel(labelView, total) : ''}
        zoom={isImages && !empty && prefs.mode === 'paged' ? (zoomCtl?.zoom ?? 1) : undefined}
        onZoomIn={zoomCtl?.zoomIn}
        onZoomOut={zoomCtl?.zoomOut}
        onZoomReset={zoomCtl?.zoomReset}
        onPrevChapter={() => prevEpisode && jumpTo(prevEpisode)}
        onNextChapter={() => nextEpisode && jumpTo(nextEpisode)}
        hasPrev={!!prevEpisode}
        hasNext={!!nextEpisode}
      />

      {sheet === 'settings' && <ReaderSettingsSheet prefs={prefs} setPref={setPref} isImages={isImages} onClose={() => setSheet('none')} />}
      {sheet === 'chapters' && (
        <ChapterDrawer
          episodes={episodes}
          currentId={episodeId}
          seen={seen}
          onJump={(ep) => {
            setSheet('none')
            jumpTo(ep)
          }}
          onClose={() => setSheet('none')}
        />
      )}
    </div>
  )
}
