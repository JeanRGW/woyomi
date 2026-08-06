import { useEffect, useRef, useState } from 'react'
import type { PageView } from './reader-nav'
import { useTouchGestures } from './pinch'
import { ReaderImage } from './ImagePage'

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
  onViewChange,
  onToggleChrome
}: {
  images: string[]
  stripWidth: number
  initialPage: number
  onViewChange: (view: PageView) => void
  onToggleChrome: () => void
}) {
  const total = images.length
  const containerRef = useRef<HTMLDivElement>(null)
  const ratiosRef = useRef(new Map<number, number>()) // file page -> width/height
  const [ratiosKnown, setRatiosKnown] = useState(0) // bump to re-render heights
  const [restored, setRestored] = useState(false)
  const reportedPage = useRef(-1)

  // restore scroll once on mount (heights are deterministic placeholders)
  useEffect(() => {
    const el = containerRef.current
    if (!el || restored || initialPage <= 0) {
      setRestored(true)
      return
    }
    const target = el.querySelector<HTMLElement>(`[data-page="${initialPage}"]`)
    if (target) {
      el.scrollTop = target.offsetTop
      setRestored(true)
    }
  }, [restored, initialPage, ratiosKnown])

  // derive current page from scroll position (viewport midpoint)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const mid = el.scrollTop + el.clientHeight / 2
        let page = 0
        const children = el.querySelectorAll<HTMLElement>('[data-page]')
        for (const child of children) {
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
  }, [total, ratiosKnown])

  // pan only; there is no strip zoom, the strip width pref is the sizing knob
  const { moved } = useTouchGestures<HTMLDivElement>({
    onPan: (dx, dy) => {
      const el = containerRef.current
      if (el) {
        el.scrollLeft -= dx
        el.scrollTop -= dy
      }
    }
  })

  // strip width is always a % of the container width, centered; no rem cap so
  // 100% gives a full-bleed webtoon column
  const sizing = { width: `${stripWidth}%` }

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col overflow-auto"
      style={{ touchAction: 'none' }}
      onClick={() => {
        if (!moved.current) onToggleChrome()
      }}
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
                alt={`page ${i + 1}`}
                eager={i <= initialPage}
                className="block h-auto w-full"
                onLoad={(e) => {
                  const img = e.currentTarget
                  if (img.naturalHeight > 0 && !ratiosRef.current.has(i)) {
                    ratiosRef.current.set(i, img.naturalWidth / img.naturalHeight)
                    setRatiosKnown((n) => n + 1)
                  }
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
