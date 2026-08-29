import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Episode } from '@woyomi/core'
import { useMediaQuery } from '../../hooks'
import { useT } from '../../i18n'
import {
  classifySwipe,
  clampZoom,
  decayVelocity,
  focalZoomAdjust,
  MIN_FLING_VELOCITY,
  nextZoom,
  pageImageClass,
  panStep,
  swipePageOffset,
  tapZoneAt,
  toggleZoom,
  viewForPage,
  viewImages,
  type PageView,
  type PageSeekRequest,
  type ReaderFit,
  type ReadingDirection
} from './reader-nav'
import { useTouchGestures } from './pinch'
import { ReaderImage } from './ImagePage'
import { ignoreReaderKey } from './reader-keyboard'
import { ChapterClosureCard } from './ChapterClosureCard'

const DOUBLE_TAP_MS = 200

export interface ZoomClusterState {
  zoom: number
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

export function PagedReader({
  images,
  direction,
  fit,
  doublePage,
  tapNav,
  initialPage,
  seek,
  chapter,
  nextEpisode,
  autoNext,
  onNext,
  onBackToSeries,
  keyboardEnabled = true,
  onViewChange,
  onToggleChrome,
  onZoomChange
}: {
  images: string[]
  direction: ReadingDirection
  fit: ReaderFit
  doublePage: boolean
  tapNav: boolean
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
  onZoomChange: (z: ZoomClusterState) => void
}) {
  const t = useT()
  const total = images.length
  const wide = useMediaQuery('(min-width: 900px)')
  const double = doublePage && wide
  const step = double ? 2 : 1

  const [page, setPage] = useState(initialPage)
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const tapTimer = useRef<number | undefined>(undefined)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const gestureStartZoom = useRef(1)
  const flingRaf = useRef<number | null>(null)
  const pendingZoomScroll = useRef<{ left: number; top: number } | null>(null)

  const view = viewForPage(page, total, double)
  const widthFit = !double && fit === 'width' && zoom === 1

  useEffect(() => {
    onViewChange(view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.start, view.count, double, total])

  const cancelFling = () => {
    if (flingRaf.current !== null) {
      cancelAnimationFrame(flingRaf.current)
      flingRaf.current = null
    }
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(tapTimer.current)
      cancelFling()
    }
  }, [])

  // reset scroll and cancel fling when the view changes
  useEffect(() => {
    cancelFling()
    const el = containerRef.current
    if (el) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
  }, [view.start])

  // RTL never reverses page order: direction only affects tap zones and the
  // double-page arrangement, so stepping is a plain file-index walk.
  const turnBy = (positions: number) => {
    cancelFling()
    setPage((prev) => Math.min(total, Math.max(0, prev + positions)))
  }

  const applyZoom = (next: number, focus?: { x: number; y: number }) => {
    cancelFling()
    const el = containerRef.current
    const prev = zoomRef.current
    const clamped = clampZoom(next)
    if (el && focus && prev > 0 && clamped !== prev) {
      const factor = clamped / prev
      const current = pendingZoomScroll.current
      pendingZoomScroll.current = {
        left: focalZoomAdjust(current?.left ?? el.scrollLeft, focus.x, factor),
        top: focalZoomAdjust(current?.top ?? el.scrollTop, focus.y, factor)
      }
    }
    zoomRef.current = clamped // keep the ref in lock-step so incremental ratios are correct
    setZoom(clamped)
  }

  useLayoutEffect(() => {
    const pending = pendingZoomScroll.current
    const el = containerRef.current
    if (!pending || !el) return
    pendingZoomScroll.current = null
    el.scrollLeft = pending.left
    el.scrollTop = pending.top
  }, [zoom])

  /** button/wheel zoom anchors the viewport center */
  const applyZoomCentered = (next: number) => {
    const el = containerRef.current
    applyZoom(next, el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : undefined)
  }

  useEffect(() => {
    onZoomChange({
      zoom,
      zoomIn: () => applyZoomCentered(nextZoom(zoomRef.current, 1)),
      zoomOut: () => applyZoomCentered(nextZoom(zoomRef.current, -1)),
      zoomReset: () => applyZoomCentered(1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const startFling = (initialVx: number, initialVy: number) => {
    cancelFling()
    const el = containerRef.current
    if (!el || (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)) return

    let vx = initialVx
    let vy = initialVy
    if (Math.hypot(vx, vy) < MIN_FLING_VELOCITY) return

    let lastTime = performance.now()

    const frame = (now: number) => {
      const elapsed = Math.max(0, now - lastTime)
      lastTime = now

      if (elapsed > 0) {
        vx = decayVelocity(vx, elapsed)
        vy = decayVelocity(vy, elapsed)

        if (Math.hypot(vx, vy) < MIN_FLING_VELOCITY) {
          flingRaf.current = null
          return
        }

        const maxScrollX = Math.max(0, el.scrollWidth - el.clientWidth)
        const maxScrollY = Math.max(0, el.scrollHeight - el.clientHeight)
        const movementTime = Math.min(elapsed, 64)

        const stepX = panStep(el.scrollLeft, -vx * movementTime, maxScrollX)
        el.scrollLeft = stepX.nextScroll
        if (stepX.stopped) vx = 0

        const stepY = panStep(el.scrollTop, -vy * movementTime, maxScrollY)
        el.scrollTop = stepY.nextScroll
        if (stepY.stopped) vy = 0

        if (vx === 0 && vy === 0) {
          flingRaf.current = null
          return
        }
      }

      flingRaf.current = requestAnimationFrame(frame)
    }

    flingRaf.current = requestAnimationFrame(frame)
  }

  const { moved } = useTouchGestures<HTMLDivElement>(containerRef, {
    onPointerDown: () => {
      cancelFling()
    },
    onPinchStart: () => {
      cancelFling()
      gestureStartZoom.current = zoomRef.current
    },
    onPinch: (factor, focus) => applyZoom(gestureStartZoom.current * factor, focus),
    onPan: (dx, dy) => {
      const el = containerRef.current
      if (el && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
        el.scrollLeft -= dx
        el.scrollTop -= dy
      }
    },
    onRelease: (info) => {
      if (!info.moved) return
      if (zoomRef.current <= 1) {
        const swipe = classifySwipe(info.dx, info.dy, info.vx)
        if (swipe) {
          const offset = swipePageOffset(swipe, direction, step)
          turnBy(offset)
          return
        }
      }
      startFling(info.vx, info.vy)
    }
  })

  useEffect(() => {
    if (!seek) return
    cancelFling()
    setPage(Math.min(total, Math.max(0, Math.floor(seek.page))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek?.requestId, total])

  useEffect(() => {
    if (!keyboardEnabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (ignoreReaderKey(event)) return
      let nextPage: number | undefined
      const nextOffset = step
      const previousOffset = -step
      if (event.key === 'ArrowLeft') nextPage = page + (direction === 'rtl' ? nextOffset : previousOffset)
      else if (event.key === 'ArrowRight') nextPage = page + (direction === 'rtl' ? previousOffset : nextOffset)
      else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) nextPage = page + nextOffset
      else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) nextPage = page + previousOffset
      else if (event.key === 'Home') nextPage = 0
      else if (event.key === 'End') nextPage = total
      if (nextPage === undefined) return
      event.preventDefault()
      turnBy(nextPage - page)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardEnabled, page, direction, step, total])

  // Ctrl+wheel zoom (non-passive; paged only)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      cancelFling()
      const rect = el.getBoundingClientRect()
      applyZoom(nextZoom(zoomRef.current, e.deltaY < 0 ? 1 : -1), { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (moved.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const focus = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    if (tapNav) {
      const zone = tapZoneAt(focus.x, rect.width)
      if (zone === 'left' || zone === 'right') {
        // Immediate side tap navigation without double-tap delay
        if (tapTimer.current !== undefined) {
          window.clearTimeout(tapTimer.current)
          tapTimer.current = undefined
        }
        const goNext = direction === 'rtl' ? zone === 'left' : zone === 'right'
        turnBy(goNext ? step : -step)
        return
      }

      // Center zone retains delayed double-tap zoom
      if (tapTimer.current !== undefined) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = undefined
        applyZoom(toggleZoom(zoomRef.current), focus)
        return
      }
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = undefined
        onToggleChrome()
      }, DOUBLE_TAP_MS)
      return
    }

    // When tapNav is false, double-tap zoom works over the full viewport
    if (tapTimer.current !== undefined) {
      window.clearTimeout(tapTimer.current)
      tapTimer.current = undefined
      applyZoom(toggleZoom(zoomRef.current), focus)
      return
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = undefined
      onToggleChrome()
    }, DOUBLE_TAP_MS)
  }

  const onPointerMoveCapture = () => {
    // a real drag cancels a pending single-tap nav/zoom timer
    if (moved.current && tapTimer.current !== undefined) {
      window.clearTimeout(tapTimer.current)
      tapTimer.current = undefined
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex h-full min-h-0 flex-col overflow-auto"
      style={{ touchAction: 'none' }}
      onClick={onClick}
      onPointerMove={onPointerMoveCapture}
    >
      {page === total ? (
        <div className="flex h-full min-h-full w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <ChapterClosureCard
            chapter={chapter}
            nextEpisode={nextEpisode}
            autoNext={autoNext}
            onNext={onNext}
            onRestart={() => setPage(0)}
            onBackToSeries={onBackToSeries}
            isVirtualPage
          />
        </div>
      ) : (
        <div
          className={`flex shrink-0 justify-center ${widthFit ? 'items-start' : 'items-center'} ${zoom > 1 ? '' : widthFit ? 'mx-auto' : 'm-auto'} ${double ? 'w-full flex-row' : ''}`}
          style={{ width: `${zoom * 100}%`, height: widthFit ? 'auto' : `${zoom * 100}%`, minHeight: widthFit ? '100%' : undefined }}
        >
          {viewImages(view, direction).map((filePage, slotIndex) => {
            const image = (
              <ReaderImage
                src={images[filePage] ?? ''}
                alt={t('reader.pageAlt', { number: filePage + 1 })}
                eager
                className={double ? 'block' : pageImageClass(fit)}
                // double: each page is contained in a half-width slot (no rem
                // caps — they left dead space at the seam on wide windows).
                // single zoomed: fill the zoom box; unzoomed keeps natural caps.
                style={
                  double
                    ? { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }
                    : zoom !== 1
                      ? { maxWidth: 'none', maxHeight: 'none', width: '100%', height: '100%', objectFit: 'contain' }
                      : undefined
                }
              />
            )
            // double always uses two fixed half-width slots hugging the center
            // seam (left slot right-aligned, right slot left-aligned): the pair
            // meets at the exact center of the box at every zoom, zero gap.
            return double ? (
              <div
                key={filePage}
                className={`flex h-full w-1/2 items-center overflow-hidden ${slotIndex === 0 ? 'justify-end' : 'justify-start'}`}
              >
                {image}
              </div>
            ) : (
              <React.Fragment key={filePage}>{image}</React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
