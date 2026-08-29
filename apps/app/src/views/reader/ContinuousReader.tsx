import { useEffect, useRef, useState } from 'react'
import type { Episode } from '@woyomi/core'
import type { PageSeekRequest, PageView } from './reader-nav'
import { prefixReady } from './reader-nav'
import { useT } from '../../i18n'
import { ReaderImage } from './ImagePage'
import { ignoreReaderKey } from './reader-keyboard'
import { ChapterClosureCard } from './ChapterClosureCard'

/**
 * Vertical long-strip reader. Single sizing control: `stripWidth` (% of the
 * screen, capped at 52rem for desktop readability); every image is stretched
 * to the column width with aspect preserved, so mixed-width webtoon pages
 * stay consistent. Page position is derived from scroll position against
 * per-image aspect-ratio placeholders, so restore works before images load.
 * ponytail: ratios are per-session (from natural sizes as images load);
 * persist them per chapter only if restore jitter is visible on slow networks.
 */
export function ContinuousReader({
  images,
  stripWidth,
  initialPage,
  seek,
  chapter,
  nextEpisode,
  autoNext,
  onNext,
  onBackToSeries,
  keyboardEnabled = true,
  onViewChange,
  onToggleChrome
}: {
  images: string[]
  stripWidth: number
  initialPage: number
  seek?: PageSeekRequest
  chapter?: Episode
  nextEpisode?: Episode
  autoNext?: boolean
  onNext?: () => void
  onBackToSeries?: () => void
  keyboardEnabled?: boolean
  onViewChange: (view: PageView) => void
  onToggleChrome: () => void
}) {
  const t = useT()
  const total = images.length
  const containerRef = useRef<HTMLDivElement>(null)
  const ratiosRef = useRef(new Map<number, number>()) // file page -> width/height
  const [ratiosKnown, setRatiosKnown] = useState(0) // bump to re-render heights
  const readyRef = useRef(new Set<number>()) // pages with a settled height (loaded OR failed)
  const [readyCount, setReadyCount] = useState(0) // bump to re-run the restore gate
  const [restored, setRestored] = useState(false)
  const reportedPage = useRef(-1)
  const userInteractedRef = useRef(false)
  const [loadThrough, setLoadThrough] = useState(() => Math.min(initialPage, total - 1))
  const [seekTarget, setSeekTarget] = useState<number | null>(null)
  // target beyond the last page means the saved position is stale; clamp so we
  // don't wait forever for a ratio that can never arrive
  const targetPage = Math.min(initialPage, total - 1)

  const markReady = (i: number) => {
    if (!readyRef.current.has(i)) {
      readyRef.current.add(i)
      setReadyCount((n) => n + 1)
    }
  }

  // restore scroll once every page above the target has a settled height (its
  // ratio landed or the image failed); before that offsetTop is ~0
  useEffect(() => {
    const el = containerRef.current
    if (!el || targetPage <= 0) {
      setRestored(true)
      return
    }
    if (restored) return
    if (userInteractedRef.current) {
      setRestored(true)
      return
    }
    if (!prefixReady(readyRef.current, targetPage)) return
    const target = el.querySelector<HTMLElement>(`[data-page="${targetPage}"]`)
    if (target) {
      el.scrollTop = target.offsetTop
      setRestored(true)
    }
  }, [restored, targetPage, readyCount, ratiosKnown])

  // a page that never settles (endless retry / hung image) must not block
  // restore forever: as a last resort, scroll to the target's placeholder
  // offset and mark restored so the reader is never stuck at page 0. If
  // readiness later completes, the corrected re-scroll effect re-positions.
  useEffect(() => {
    if (restored || targetPage <= 0) return
    const t = window.setTimeout(() => {
      if (userInteractedRef.current) {
        setRestored(true)
        return
      }
      if (prefixReady(readyRef.current, targetPage)) return // gate will handle it
      const el = containerRef.current
      const target = el?.querySelector<HTMLElement>(`[data-page="${targetPage}"]`)
      if (target && el) {
        el.scrollTop = target.offsetTop
        setRestored(true)
      }
    }, 2000)
    return () => window.clearTimeout(t)
  }, [restored, targetPage, readyCount])

  // correct a coarse fallback restore once the prefix heights land
  useEffect(() => {
    if (restored && !userInteractedRef.current && targetPage > 0 && prefixReady(readyRef.current, targetPage)) {
      const el = containerRef.current
      const target = el?.querySelector<HTMLElement>(`[data-page="${targetPage}"]`)
      if (target && el) el.scrollTop = target.offsetTop
    }
  }, [restored, targetPage, readyCount])

  // Seeking ahead eagerly settles the prefix so the target's offset is real.
  useEffect(() => {
    if (!seek) return
    const page = Math.min(total - 1, Math.max(0, Math.floor(seek.page)))
    userInteractedRef.current = true
    setRestored(true)
    setLoadThrough((current) => Math.max(current, page))
    setSeekTarget(page)
  }, [seek, total])

  useEffect(() => {
    if (seekTarget === null || (seekTarget > 0 && !prefixReady(readyRef.current, seekTarget))) return
    const el = containerRef.current
    const target = el?.querySelector<HTMLElement>(`[data-page="${seekTarget}"]`)
    if (el && target) {
      el.scrollTop = target.offsetTop
      setSeekTarget(null)
    }
  }, [seekTarget, readyCount])

  // A hung image should not make the scrubber unresponsive forever.
  useEffect(() => {
    if (seekTarget === null) return
    const timeout = window.setTimeout(() => {
      const el = containerRef.current
      const target = el?.querySelector<HTMLElement>(`[data-page="${seekTarget}"]`)
      if (el && target) el.scrollTop = target.offsetTop
    }, 2000)
    return () => window.clearTimeout(timeout)
  }, [seekTarget])

  // derive current page from scroll position (viewport midpoint)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!restored) return
        if (targetPage > 0 && !userInteractedRef.current && !prefixReady(readyRef.current, targetPage)) return
        const mid = el.scrollTop + el.clientHeight / 2
        let page = 0
        const children = el.querySelectorAll<HTMLElement>('[data-page]')
        for (const child of children) {
          if (child.offsetHeight <= 0) break
          const idx = Number(child.dataset.page)
          if (child.offsetTop <= mid) page = idx
          else break
        }
        if (page !== reportedPage.current) {
          reportedPage.current = page
          onViewChange({ start: page, count: 1, readingStart: page, readingEnd: page })
        }
      })
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, ratiosKnown, restored, targetPage])

  // Track real direct manipulation so late image settlement cannot undo it.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let pointer: { id: number; x: number; y: number } | undefined
    const onPointerDown = (event: PointerEvent) => {
      if (event.isPrimary) pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) {
        userInteractedRef.current = true
        setRestored(true)
        setSeekTarget(null)
      }
    }
    const onPointerEnd = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = undefined
    }
    const onWheel = () => {
      userInteractedRef.current = true
      setRestored(true)
      setSeekTarget(null)
    }
    const onUserScroll = () => {
      if (pointer) {
        userInteractedRef.current = true
        setRestored(true)
        setSeekTarget(null)
      }
    }
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('pointermove', onPointerMove, { passive: true })
    el.addEventListener('pointerup', onPointerEnd, { passive: true })
    el.addEventListener('pointercancel', onPointerEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('scroll', onUserScroll, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', onUserScroll)
    }
  }, [])

  useEffect(() => {
    if (!keyboardEnabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (ignoreReaderKey(event)) return
      const el = containerRef.current
      if (!el) return
      const pageDelta = el.clientHeight * 0.85
      let top: number | undefined
      if (event.key === 'ArrowDown') top = 48
      else if (event.key === 'ArrowUp') top = -48
      else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) top = pageDelta
      else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) top = -pageDelta
      else if (event.key === 'Home') top = -el.scrollHeight
      else if (event.key === 'End') top = el.scrollHeight
      if (top === undefined) return
      event.preventDefault()
      userInteractedRef.current = true
      setRestored(true)
      setSeekTarget(null)
      el.scrollBy({ top })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keyboardEnabled])

  // strip width is always a % of the container width, centered; no rem cap so
  // 100% gives a full-bleed webtoon column
  const sizing = { width: `${stripWidth}%` }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
      style={{ touchAction: 'pan-y' }}
      onClick={onToggleChrome}
    >
      <div className="mx-auto flex flex-col items-stretch gap-1.5" style={sizing}>
        {images.map((src, i) => {
          const ratio = ratiosRef.current.get(i)
          return (
            <div
              key={i}
              data-page={i}
              // placeholder with the last known aspect ratio so scroll positions
              // are stable before (and while) images load
              style={ratio ? { aspectRatio: String(ratio) } : undefined}
            >
              {/* w-full forces every page to the strip width, aspect kept */}
              <ReaderImage
                src={src}
                alt={t('reader.pageAlt', { number: i + 1 })}
                eager={i <= loadThrough}
                className="block h-auto w-full"
                onLoad={(e) => {
                  const img = e.currentTarget
                  if (img.naturalHeight > 0 && !ratiosRef.current.has(i)) {
                    ratiosRef.current.set(i, img.naturalWidth / img.naturalHeight)
                    setRatiosKnown((n) => n + 1)
                  }
                  markReady(i)
                }}
                onError={() => markReady(i)}
              />
            </div>
          )
        })}
        <div onClick={(e) => e.stopPropagation()}>
          <ChapterClosureCard
            chapter={chapter}
            nextEpisode={nextEpisode}
            autoNext={autoNext}
            canAutoAdvance={restored}
            onNext={onNext}
            onRestart={() => {
              const el = containerRef.current
              if (el) el.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            onBackToSeries={onBackToSeries}
          />
        </div>
      </div>
    </div>
  )
}
