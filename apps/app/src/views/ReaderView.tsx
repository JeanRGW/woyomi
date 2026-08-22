import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterContent, Episode, Media } from '@woyomi/core'
import { imageSrc, type AppRuntime } from '../runtime'
import { navigate } from '../App'
import { recordOpen } from '../hooks'
import { useT } from '../i18n'
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
  const t = useT()
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
  const lastSavedRef = useRef<number | null>(null)
  // live mirror of `view` so unmount-time effects read the current page
  const viewRef = useRef(view)
  viewRef.current = view

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

  // position + finish + auto-advance
  const finished = total > 0 && view.readingEnd === total - 1

  // save on finish: persists the "read to the end" marker, and auto-advances
  // in the same effect so it can't be unmounted past a pending save.
  // `lastSavedRef` re-saves `total` if the reader comes back to the end.
  useEffect(() => {
    if (total === 0 || initialPage === null) return
    if (finished && lastSavedRef.current !== total) {
      lastSavedRef.current = total
      saveReadPosition(runtime.engine.prefs, episodeId, total)
      if (prefs.autoNext && nextEpisode && !autoAdvanceFired.current) {
        autoAdvanceFired.current = true
        jumpTo(nextEpisode)
      }
    }
  }, [finished, total, initialPage, runtime, episodeId, prefs.autoNext, nextEpisode, jumpTo])

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
      if (lastSavedRef.current === null && lastView.readingStart > 0) {
        saveReadPosition(runtime.engine.prefs, episodeId, lastView.readingStart)
      }
    }
  }, [runtime, episodeId, viewRef])

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

  return (
    <div className="relative h-full min-h-0 overflow-hidden" style={{ backgroundColor: BACKGROUNDS[prefs.background] }}>
      {empty ? (
        <div className="grid h-full place-items-center px-4">
          <p className="mx-auto max-w-md py-10 text-center text-sm text-muted">{t('reader.emptyChapter')}</p>
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
