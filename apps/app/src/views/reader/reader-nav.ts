import type { Episode } from '@media-platform/core'

export type ReadingDirection = 'rtl' | 'ltr' | 'vertical'
export type ReaderMode = 'continuous' | 'paged'
export type ReaderFit = 'width' | 'page'
export type ReaderBackground = 'ink' | 'black' | 'sepia'

/** Reading-order properties of the view live in FILE order: source page order
 * is never reversed (RTL only affects tap zones and double-page arrangement). */
export interface PageView {
  start: number
  count: 1 | 2
  /** earliest/latest file page in the view */
  readingStart: number
  readingEnd: number
}

/** Direction-free; the caller maps left/right to prev/next. */
export type TapZone = 'left' | 'center' | 'right'
export function tapZoneAt(x: number, width: number): TapZone {
  if (x < width / 3) return 'left'
  if (x >= (2 * width) / 3) return 'right'
  return 'center'
}

/** Resume only mid-chapter; a stored total (finished) or junk restarts at 0. */
export function restorePage(saved: number | undefined, total: number): number {
  if (saved === undefined || total <= 1) return 0
  return saved > 0 && saved < total - 1 ? Math.floor(saved) : 0
}

/** Adjacent episode in list order (already sorted by the source); undefined at the ends. */
export function findAdjacent(episodes: Episode[], currentId: string, relative: -1 | 1): Episode | undefined {
  const idx = episodes.findIndex((e) => e.id === currentId)
  return idx < 0 ? undefined : episodes[idx + relative]
}

/** View containing file page `page`; double-page snaps to even boundaries. */
export function viewForPage(page: number, total: number, double: boolean): PageView {
  if (!double || total <= 1) return { start: page, count: 1, readingStart: page, readingEnd: page }
  const start = page % 2 === 0 ? page : page - 1
  const count = start + 1 < total ? 2 : 1
  return count === 2
    ? { start, count, readingStart: start, readingEnd: start + 1 }
    : { start, count, readingStart: start, readingEnd: start }
}

/** File page indexes in display order (earlier page first for LTR, last for RTL). */
export function viewImages(view: PageView, direction: ReadingDirection): number[] {
  const pages = view.count === 2 ? [view.start, view.start + 1] : [view.start]
  return direction === 'rtl' ? pages.reverse() : pages
}

/** Label for the view, e.g. 7 / 33 or 7–8 / 33 (1-based, reading order). */
export function viewLabel(view: PageView, total: number): string {
  return view.count === 2
    ? `${view.readingStart + 1}–${view.readingEnd + 1} / ${total}`
    : `${view.readingStart + 1} / ${total}`
}

/** True when every file page in `[0, upTo)` has a settled height (its image
 * loaded or failed), so `offsetTop` of page `upTo` is meaningful. */
export function prefixReady(ready: ReadonlySet<number>, upTo: number): boolean {
  for (let i = 0; i < upTo; i++) {
    if (!ready.has(i)) return false
  }
  return true
}

/** Per-image classes; the 26rem spread cap lives on the double-page container. */
export function pageImageClass(fit: ReaderFit): string {
  return fit === 'page'
    ? 'block m-auto h-auto w-auto max-w-[min(100%,52rem)] max-h-[100vh] object-contain'
    : 'block m-auto w-full max-w-[min(100%,52rem)]'
}

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 4

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

/** x1.25 steps rounded to 0.05 so the % label stays readable. */
export function nextZoom(z: number, dir: 1 | -1): number {
  const raw = dir === 1 ? z * 1.25 : z / 1.25
  return clampZoom(Math.round(raw * 20) / 20)
}

export function toggleZoom(z: number): number {
  return z === 1 ? 2 : 1
}

/** Keep `focus` (container coords) stable while scaling: scroll' = (scroll + focus) * factor - focus. */
export function focalZoomAdjust(scroll: number, focus: number, factor: number): number {
  return (scroll + focus) * factor - focus
}
