import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterContent, Episode, Media } from '@woyomi/core'
import { imageSrc, type AppRuntime } from '../runtime'
import { navigate } from '../App'
import { recordOpen } from '../hooks'
import { useT } from '../i18n'
import { BackButton, Banner, Page } from '../components'
import { findAdjacent, restorePage, viewLabel, type PageSeekRequest, type PageView } from './reader/reader-nav'
import {
  BACKGROUNDS,
  NOVEL_FOREGROUNDS,
  getReadPosition,
  getTextPosition,
  restoreTextProgress,
  saveReadPosition,
  saveTextPosition,
  useReaderPrefs
} from './reader/reader-prefs'
import { PagedReader, type ZoomClusterState } from './reader/PagedReader'
import { ContinuousReader } from './reader/ContinuousReader'
import { ReaderChrome } from './reader/ReaderChrome'
import { ChapterDrawer, ReaderSettingsSheet } from './reader/ReaderSettings'
import { NovelReader, type NovelSeekRequest } from './reader/NovelReader'
import { useWakeLock } from './reader/useWakeLock'

export function ReaderView({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  return <ReaderSession key={episodeId} runtime={runtime} sourceId={sourceId} mediaId={mediaId} episodeId={episodeId} />
}

function ReaderSession({ runtime, sourceId, mediaId, episodeId }: { runtime: AppRuntime; sourceId: string; mediaId: string; episodeId: string }) {
  const t = useT()
  const [content, setContent] = useState<ChapterContent | null>(null)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<Media | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [seen, setSeen] = useState<Set<string>>(new Set())

  const { prefs, loaded: prefsLoaded, set: setPref, hasTitleOverride, toggleTitleOverride } = useReaderPrefs(
    runtime.engine.prefs,
    `${sourceId}/${mediaId}`
  )
  const [initialPage, setInitialPage] = useState<number | null>(null)
  const [initialTextProgress, setInitialTextProgress] = useState<number | null>(null)
  const [textProgress, setTextProgress] = useState(0)
  const [view, setView] = useState<PageView>({ start: 0, count: 1, readingStart: 0, readingEnd: 0 })
  const [chromeVisible, setChromeVisible] = useState(false)
  const [sheet, setSheet] = useState<'none' | 'settings' | 'chapters'>('none')
  const [zoomCtl, setZoomCtl] = useState<ZoomClusterState | null>(null)
  const [pageSeek, setPageSeek] = useState<PageSeekRequest>()
  const [textSeek, setTextSeek] = useState<NovelSeekRequest>()

  const lastSavedRef = useRef<number | null>(null)
  const lastSavedTextRef = useRef<number | null>(null)
  const seekRequestId = useRef(0)
  // live mirror of `view` so unmount-time effects read the current page
  const viewRef = useRef(view)
  viewRef.current = view
  const textProgressRef = useRef(textProgress)
  textProgressRef.current = textProgress
  const hasReportedView = useRef(false)
  const readerContentRef = useRef<HTMLDivElement>(null)
  const handleViewChange = useCallback((nextView: PageView) => {
    hasReportedView.current = true
    setView(nextView)
  }, [])
  const closeSheet = useCallback(() => setSheet('none'), [])

  const total = content?.type === 'pages' ? content.images.length : 0
  const totalRef = useRef(total)
  totalRef.current = total

  useWakeLock(prefsLoaded && prefs.keepAwake)

  useEffect(() => {
    readerContentRef.current?.toggleAttribute('inert', sheet !== 'none')
  }, [sheet])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const local = await runtime.downloads?.localChapterContent(episodeId)
        if (cancelled) return
        if (local) {
          setContent(local)
          return
        }
        const chapterContent = await runtime.engine.getChapterContent(sourceId, mediaId, episodeId)
        if (!cancelled) {
          setContent(
            chapterContent.type === 'pages' && chapterContent.headers
              ? { ...chapterContent, images: chapterContent.images.map((url) => imageSrc(url, chapterContent.headers) ?? url) }
            : chapterContent
          )
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runtime, sourceId, mediaId, episodeId])

  // chrome/nav context — non-fatal
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let metadata: [Media, Episode[]]
      try {
        metadata = await Promise.all([runtime.engine.getMedia(sourceId, mediaId), runtime.engine.getEpisodes(sourceId, mediaId)])
      } catch {
        try {
          const record = await runtime.downloads?.get(episodeId)
          if (cancelled || record?.state !== 'complete' || record.kind === 'mp4') return
          setMedia(record.media)
          setEpisodes([record.episode])
          await recordOpen(runtime, record.media, record.episode)
        } catch {
          // titles/chapter nav just stay minimal
        }
        return
      }

      const [m, eps] = metadata
      try {
        const prog = await runtime.store.getProgress(m.id)
        if (cancelled) return
        setMedia(m)
        setEpisodes(eps)
        setSeen(new Set(prog?.seenEpisodeIds ?? []))
        const ep = eps.find((e) => e.id === episodeId)
        if (ep) await recordOpen(runtime, m, ep)
      } catch {
        // titles/chapter nav just stay minimal
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runtime, sourceId, mediaId, episodeId])

  // restore position once prefs + pages are known
  useEffect(() => {
    if (!prefsLoaded || total === 0 || initialPage !== null) return
    let cancelled = false
    getReadPosition(runtime.engine.prefs, episodeId).then((saved) => {
      if (cancelled) return
      const restoredPage = restorePage(saved, total)
      setView({ start: restoredPage, count: 1, readingStart: restoredPage, readingEnd: restoredPage })
      setInitialPage(restoredPage)
    })
    return () => {
      cancelled = true
    }
  }, [runtime, prefsLoaded, total, initialPage, sourceId, mediaId, episodeId])

  useEffect(() => {
    if (!prefsLoaded || content?.type !== 'text' || initialTextProgress !== null) return
    let cancelled = false
    getTextPosition(runtime.engine.prefs, episodeId).then((saved) => {
      if (cancelled) return
      const restored = restoreTextProgress(saved)
      setInitialTextProgress(restored)
      setTextProgress(restored)
    })
    return () => {
      cancelled = true
    }
  }, [runtime, prefsLoaded, content, initialTextProgress, episodeId])

  const prevEpisode = findAdjacent(episodes, episodeId, -1)
  const nextEpisode = findAdjacent(episodes, episodeId, 1)

  // in-reader chapter jumps replace history so Back returns to the media page
  const jumpTo = useCallback(
    (ep: Episode) => navigate({ name: 'reader', sourceId, mediaId, episodeId: ep.id }, { replace: true }),
    [sourceId, mediaId]
  )

  // position + finish + auto-advance
  const finished = total > 0 && view.readingEnd === total - 1

  // save on finish: persists the "read to the end" marker
  // `lastSavedRef` re-saves `total` if the reader comes back to the end.
  useEffect(() => {
    if (total === 0 || initialPage === null) return
    if (!finished) return
    if (lastSavedRef.current !== total) {
      lastSavedRef.current = total
      saveReadPosition(runtime.engine.prefs, episodeId, total)
    }
  }, [finished, total, initialPage, runtime, episodeId])

  // mid-chapter position is saved debounced (continuous scroll re-views pages)
  useEffect(() => {
    if (total === 0 || initialPage === null || finished) return
    const t = window.setTimeout(() => {
      lastSavedRef.current = view.readingStart
      saveReadPosition(runtime.engine.prefs, episodeId, view.readingStart)
    }, 400)
    return () => window.clearTimeout(t)
  }, [runtime, episodeId, view.readingStart, total, initialPage, finished])

  // flush a pending position on unmount (quick exit inside the debounce window)
  useEffect(() => {
    return () => {
      const lastView = viewRef.current
      const finalTotal = totalRef.current
      if (finalTotal === 0) return
      const position = lastView.readingEnd === finalTotal - 1 ? finalTotal : lastView.readingStart
      if (lastSavedRef.current !== position) saveReadPosition(runtime.engine.prefs, episodeId, position)
    }
  }, [runtime, episodeId])

  const textFinished = content?.type === 'text' && !!content.html.trim() && textProgress >= 0.99

  useEffect(() => {
    if (content?.type !== 'text' || initialTextProgress === null || !textFinished) return
    if (lastSavedTextRef.current !== 1) {
      lastSavedTextRef.current = 1
      saveTextPosition(runtime.engine.prefs, episodeId, 1)
    }
  }, [content, initialTextProgress, textFinished, runtime, episodeId])

  useEffect(() => {
    if (content?.type !== 'text' || initialTextProgress === null || textFinished) return
    const timeout = window.setTimeout(() => {
      lastSavedTextRef.current = textProgress
      saveTextPosition(runtime.engine.prefs, episodeId, textProgress)
    }, 400)
    return () => window.clearTimeout(timeout)
  }, [content, initialTextProgress, textFinished, textProgress, runtime, episodeId])

  useEffect(() => {
    return () => {
      const progress = textProgressRef.current
      const position = progress >= 0.99 ? 1 : progress
      if (position > 0 && lastSavedTextRef.current !== position) saveTextPosition(runtime.engine.prefs, episodeId, position)
    }
  }, [runtime, episodeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (sheet !== 'none') {
        event.preventDefault()
        setSheet('none')
      } else if (chromeVisible) {
        event.preventDefault()
        setChromeVisible(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sheet, chromeVisible])

  if (error)
    return (
      <Page>
        <BackButton />
        <Banner tone="error">{error}</Banner>
      </Page>
    )

  if (
    !content ||
    (content.type === 'pages' && content.images.length > 0 && initialPage === null) ||
    (content.type === 'text' && initialTextProgress === null)
  ) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-muted">{t('common.loadingChapter')}</p>
      </div>
    )
  }

  const isImages = content.type === 'pages'
  const empty = isImages ? total === 0 : !content.html.trim()
  const chapter = episodes.find((e) => e.id === episodeId)
  const chapterLabel = chapter
    ? `${t('common.chapter', { number: chapter.number })}${chapter.season != null ? t('common.season', { season: chapter.season }) : ''}${
        chapter.title ? t('common.title', { title: chapter.title }) : ''
      }`
    : ''
  const continuousView = { start: view.start, count: 1 as const, readingStart: view.start, readingEnd: view.start }
  const labelView = prefs.mode === 'paged' ? view : continuousView
  // strip mode is always vertical; pages mode is rtl/ltr (stored value may be
  // stale from the other mode, so coerce here too)
  const pagedDirection = prefs.direction === 'vertical' ? 'rtl' : prefs.direction
  const keyboardEnabled = sheet === 'none'
  const readerInitialPage = hasReportedView.current ? view.readingStart : (initialPage ?? 0)
  const requestSeek = (value: number) => {
    seekRequestId.current += 1
    if (isImages) setPageSeek({ page: value, requestId: seekRequestId.current })
    else setTextSeek({ progress: value / 1000, requestId: seekRequestId.current })
  }
  const progress = isImages && total > 0 ? (labelView.readingEnd + 1) / total : textProgress
  const pageLabel = isImages && total > 0 ? viewLabel(labelView, total) : t('reader.progressPercent', { value: Math.round(textProgress * 100) })

  return (
    <div className="relative h-full min-h-0 overflow-hidden" style={{ backgroundColor: BACKGROUNDS[prefs.background] }}>
      <div ref={readerContentRef} className="h-full min-h-0" aria-hidden={sheet !== 'none'}>
        {empty ? (
          <div className="grid h-full place-items-center px-4">
            <p
              className="mx-auto max-w-md py-10 text-center text-sm"
              style={{ color: prefs.background === 'sepia' ? NOVEL_FOREGROUNDS.sepia : 'var(--color-muted)' }}
            >
              {t('reader.emptyChapter')}
            </p>
          </div>
        ) : isImages ? (
          prefs.mode === 'paged' ? (
            <PagedReader
              images={content.images}
              direction={pagedDirection}
              fit={prefs.fit}
              doublePage={prefs.doublePage}
              tapNav={prefs.tapNav}
              initialPage={readerInitialPage}
              seek={pageSeek}
              chapter={chapter}
              nextEpisode={nextEpisode}
              autoNext={prefs.autoNext}
              onNext={() => nextEpisode && jumpTo(nextEpisode)}
              onBackToSeries={() => navigate({ name: 'media', sourceId, mediaId })}
              keyboardEnabled={keyboardEnabled}
              onViewChange={handleViewChange}
              onToggleChrome={() => setChromeVisible((v) => !v)}
              onZoomChange={setZoomCtl}
            />
          ) : (
            <ContinuousReader
              images={content.images}
              stripWidth={prefs.stripWidth}
              initialPage={readerInitialPage}
              seek={pageSeek}
              chapter={chapter}
              nextEpisode={nextEpisode}
              autoNext={prefs.autoNext}
              onNext={() => nextEpisode && jumpTo(nextEpisode)}
              onBackToSeries={() => navigate({ name: 'media', sourceId, mediaId })}
              keyboardEnabled={keyboardEnabled}
              onViewChange={handleViewChange}
              onToggleChrome={() => setChromeVisible((v) => !v)}
            />
          )
        ) : (
          <NovelReader
            html={content.html}
            initialProgress={initialTextProgress ?? 0}
            prefs={prefs}
            chapter={chapter}
            nextEpisode={nextEpisode}
            autoNext={prefs.autoNext}
            onNext={() => nextEpisode && jumpTo(nextEpisode)}
            onBackToSeries={() => navigate({ name: 'media', sourceId, mediaId })}
            keyboardEnabled={keyboardEnabled}
            seek={textSeek}
            onProgressChange={setTextProgress}
            onToggleChrome={() => setChromeVisible((visible) => !visible)}
          />
        )}
      </div>

      <ReaderChrome
        visible={chromeVisible && sheet === 'none'}
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
        progress={progress}
        pageLabel={pageLabel}
        seekValue={isImages ? labelView.readingStart : Math.round(textProgress * 1000)}
        seekMax={isImages ? total - 1 : 1000}
        onSeek={empty ? undefined : requestSeek}
        zoom={isImages && !empty && prefs.mode === 'paged' ? (zoomCtl?.zoom ?? 1) : undefined}
        onZoomIn={zoomCtl?.zoomIn}
        onZoomOut={zoomCtl?.zoomOut}
        onZoomReset={zoomCtl?.zoomReset}
        onPrevChapter={() => prevEpisode && jumpTo(prevEpisode)}
        onNextChapter={() => nextEpisode && jumpTo(nextEpisode)}
        hasPrev={!!prevEpisode}
        hasNext={!!nextEpisode}
      />

      {sheet === 'settings' && (
        <ReaderSettingsSheet
          prefs={prefs}
          setPref={setPref}
          isImages={isImages}
          hasTitleOverride={hasTitleOverride}
          onToggleTitleOverride={toggleTitleOverride}
          onClose={closeSheet}
        />
      )}
      {sheet === 'chapters' && (
        <ChapterDrawer
          episodes={episodes}
          currentId={episodeId}
          seen={seen}
          onJump={(ep) => {
            closeSheet()
            jumpTo(ep)
          }}
          onClose={closeSheet}
        />
      )}
    </div>
  )
}
