import React, { useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '../../hooks'
import {
  clampZoom,
  focalZoomAdjust,
  nextZoom,
  pageImageClass,
  tapZoneAt,
  toggleZoom,
  viewForPage,
  viewImages,
  type PageView,
  type ReaderFit,
  type ReadingDirection
} from './reader-nav'
import { useTouchGestures } from './pinch'
import { ReaderImage } from './ImagePage'

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
  onViewChange,
  onToggleChrome,
  zoomResetSignal,
  onZoomChange
}: {
  images: string[]
  direction: ReadingDirection
  fit: ReaderFit
  doublePage: boolean
  tapNav: boolean
  initialPage: number
  onViewChange: (view: PageView) => void
  onToggleChrome: () => void
  /** increments when the parent wants zoom back to 1 (episode change) */
  zoomResetSignal: number
  onZoomChange: (z: ZoomClusterState) => void
}) {
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

  const view = viewForPage(page, total, double)

  useEffect(() => {
    onViewChange(view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.start, view.count, double, total])

  useEffect(() => setZoom(1), [zoomResetSignal])
  useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  // reset scroll when the view changes
  useEffect(() => {
    const el = containerRef.current
    if (el) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
  }, [view.start])

  // RTL never reverses page order: direction only affects tap zones and the
  // double-page arrangement, so stepping is a plain file-index walk.
  const turnBy = (positions: number) => {
    setPage((prev) => Math.min(total - 1, Math.max(0, prev + positions)))
  }

  const applyZoom = (next: number, focus?: { x: number; y: number }) => {
    const el = containerRef.current
    const prev = zoomRef.current
    const clamped = clampZoom(next)
    setZoom(clamped)
    if (el && focus && prev > 0 && prev !== clamped) {
      const factor = clamped / prev
      // apply after layout so scroll ranges reflect the new size
      requestAnimationFrame(() => {
        el.scrollLeft = focalZoomAdjust(el.scrollLeft, focus.x, factor)
        el.scrollTop = focalZoomAdjust(el.scrollTop, focus.y, factor)
      })
    }
  }

  /** button/wheel/double-tap zoom anchors the viewport center; pinch anchors the gesture point */
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

  const { moved } = useTouchGestures<HTMLDivElement>({
    onPinch: (factor, focus) => applyZoom(gestureStartZoom.current * factor, focus),
    onPan: (dx, dy) => {
      const el = containerRef.current
      if (el && zoomRef.current > 1) {
        el.scrollLeft -= dx
        el.scrollTop -= dy
      }
    }
  })

  // capture zoom at pinch start (on the second pointer going down)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let touches = 0
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touches += 1
      if (touches === 2) gestureStartZoom.current = zoomRef.current
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') touches = Math.max(0, touches - 1)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // Ctrl+wheel zoom (non-passive; paged only)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      applyZoom(nextZoom(zoomRef.current, e.deltaY < 0 ? 1 : -1), { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** First tap schedules the action; a second tap cancels it and toggles zoom. */
  const scheduleTap = (action: () => void) => {
    if (tapTimer.current !== undefined) {
      window.clearTimeout(tapTimer.current)
      tapTimer.current = undefined
      applyZoomCentered(toggleZoom(zoomRef.current))
      return
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = undefined
      action()
    }, DOUBLE_TAP_MS)
  }

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (moved.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left

    if (tapNav) {
      const zone = tapZoneAt(x, rect.width)
      if (zone === 'center') {
        scheduleTap(() => onToggleChrome())
        return
      }
      const goNext = direction === 'rtl' ? zone === 'left' : zone === 'right'
      scheduleTap(() => turnBy(goNext ? step : -step))
      return
    }
    scheduleTap(() => onToggleChrome())
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
      className="flex h-full min-h-0 flex-col overflow-auto"
      style={{ touchAction: 'none' }}
      onClick={onClick}
      onPointerMove={onPointerMoveCapture}
    >
      <div
        className={`m-auto flex items-center justify-center ${double ? 'w-full flex-row' : ''}`}
        style={{ width: `${zoom * 100}vw`, height: `${zoom * 100}vh` }}
      >
        {viewImages(view, direction).map((filePage, slotIndex) => {
          const image = (
            <ReaderImage
              src={images[filePage] ?? ''}
              alt={`page ${filePage + 1}`}
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
    </div>
  )
}
