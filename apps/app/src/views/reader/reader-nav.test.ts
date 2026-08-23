import { describe, expect, it } from 'vitest'
import type { Episode } from '@woyomi/core'
import {
  classifySwipe,
  clampZoom,
  decayVelocity,
  findAdjacent,
  focalZoomAdjust,
  nextZoom,
  pageImageClass,
  panStep,
  prefixReady,
  restorePage,
  swipePageOffset,
  tapZoneAt,
  toggleZoom,
  viewForPage,
  viewImages,
  viewLabel
} from './reader-nav'

describe('tapZoneAt', () => {
  it('splits the width into thirds', () => {
    expect(tapZoneAt(0, 300)).toBe('left')
    expect(tapZoneAt(99, 300)).toBe('left')
    expect(tapZoneAt(100, 300)).toBe('center')
    expect(tapZoneAt(150, 300)).toBe('center')
    expect(tapZoneAt(200, 300)).toBe('right')
    expect(tapZoneAt(299, 300)).toBe('right')
  })
})

describe('restorePage', () => {
  it('resumes only mid-chapter', () => {
    expect(restorePage(7, 33)).toBe(7)
    expect(restorePage(1, 33)).toBe(1)
  })

  it('finished (saved === total) or unset restarts at 0', () => {
    expect(restorePage(33, 33)).toBe(0)
    expect(restorePage(32, 33)).toBe(0) // last file page: treat as done
    expect(restorePage(undefined, 33)).toBe(0)
    expect(restorePage(0, 33)).toBe(0)
    expect(restorePage(99, 33)).toBe(0)
    expect(restorePage(-2, 33)).toBe(0)
  })

  it('floors fractional saves', () => {
    expect(restorePage(7.9, 33)).toBe(7)
  })
})

describe('findAdjacent', () => {
  const eps = [
    { id: 's/m/1', number: 1, mediaId: 'm' },
    { id: 's/m/2', number: 2, mediaId: 'm' },
    { id: 's/m/3', number: 3, mediaId: 'm' }
  ] satisfies Episode[]

  it('finds next and prev', () => {
    expect(findAdjacent(eps, 's/m/2', 1)?.id).toBe('s/m/3')
    expect(findAdjacent(eps, 's/m/2', -1)?.id).toBe('s/m/1')
  })

  it('returns undefined at the ends and for unknown ids', () => {
    expect(findAdjacent(eps, 's/m/1', -1)).toBeUndefined()
    expect(findAdjacent(eps, 's/m/3', 1)).toBeUndefined()
    expect(findAdjacent(eps, 'nope', 1)).toBeUndefined()
    expect(findAdjacent([], 's/m/1', 1)).toBeUndefined()
  })
})

describe('prefixReady', () => {
  it('all pages before upTo must be ready', () => {
    expect(prefixReady(new Set([0, 1, 2]), 3)).toBe(true)
    expect(prefixReady(new Set([0, 2]), 3)).toBe(false)
    expect(prefixReady(new Set([0, 1, 2, 3]), 3)).toBe(true)
  })
  it('empty prefix is trivially ready; upTo 0 is always ready', () => {
    expect(prefixReady(new Set(), 0)).toBe(true)
    expect(prefixReady(new Set(), 5)).toBe(false)
  })
})

describe('viewForPage', () => {
  it('single: view is the page itself', () => {
    expect(viewForPage(5, 33, false)).toEqual({ start: 5, count: 1, readingStart: 5, readingEnd: 5 })
  })

  it('double: snaps to even boundaries', () => {
    expect(viewForPage(4, 33, true)).toEqual({ start: 4, count: 2, readingStart: 4, readingEnd: 5 })
    expect(viewForPage(5, 33, true)).toEqual({ start: 4, count: 2, readingStart: 4, readingEnd: 5 })
    expect(viewForPage(0, 33, true)).toEqual({ start: 0, count: 2, readingStart: 0, readingEnd: 1 })
  })

  it('double with odd total: trailing page shows alone', () => {
    expect(viewForPage(32, 33, true)).toEqual({ start: 32, count: 1, readingStart: 32, readingEnd: 32 })
  })

  it('single-page chapter ignores double', () => {
    expect(viewForPage(0, 1, true)).toEqual({ start: 0, count: 1, readingStart: 0, readingEnd: 0 })
  })
})

describe('viewImages', () => {
  it('ltr shows earlier page first, rtl shows it on the right', () => {
    const view = viewForPage(4, 33, true)
    expect(viewImages(view, 'ltr')).toEqual([4, 5])
    expect(viewImages(view, 'rtl')).toEqual([5, 4])
  })

  it('single view is unaffected', () => {
    expect(viewImages(viewForPage(7, 33, false), 'rtl')).toEqual([7])
  })
})

describe('viewLabel', () => {
  it('single and range labels are 1-based', () => {
    expect(viewLabel(viewForPage(6, 33, false), 33)).toBe('7 / 33')
    expect(viewLabel(viewForPage(6, 33, true), 33)).toBe('7–8 / 33')
    expect(viewLabel(viewForPage(32, 33, true), 33)).toBe('33 / 33')
  })

  it('page numbering is linear — RTL never reverses the plugin page order', () => {
    expect(viewLabel(viewForPage(0, 33, false), 33)).toBe('1 / 33')
    expect(viewLabel(viewForPage(0, 33, true), 33)).toBe('1–2 / 33')
    expect(viewLabel(viewForPage(30, 33, true), 33)).toBe('31–32 / 33')
  })
})

describe('pageImageClass', () => {
  it('caps at 52rem; fit page also caps height', () => {
    expect(pageImageClass('width')).toContain('max-w-[min(100%,52rem)]')
    expect(pageImageClass('width')).toContain('w-full')
    expect(pageImageClass('page')).toContain('max-w-[min(100%,52rem)]')
    expect(pageImageClass('page')).toContain('max-h-full')
    expect(pageImageClass('page')).toContain('object-contain')
  })
})

describe('zoom helpers', () => {
  it('clampZoom bounds to 0.5–4', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(9)).toBe(4)
    expect(clampZoom(1.7)).toBe(1.7)
  })

  it('nextZoom steps x1.25 rounded to 0.05 and clamps', () => {
    expect(nextZoom(1, 1)).toBe(1.25)
    expect(nextZoom(1.25, 1)).toBe(1.55)
    expect(nextZoom(1, -1)).toBe(0.8)
    expect(nextZoom(0.8, -1)).toBe(0.65)
    expect(nextZoom(4, 1)).toBe(4)
    expect(nextZoom(0.5, -1)).toBe(0.5)
  })

  it('toggleZoom flips 1 <-> 2', () => {
    expect(toggleZoom(1)).toBe(2)
    expect(toggleZoom(2)).toBe(1)
    expect(toggleZoom(1.5)).toBe(1)
  })

  it('focalZoomAdjust keeps the focus point stable', () => {
    // content under focus: (scroll + focus); after scaling it must map back to focus
    const next = focalZoomAdjust(100, 200, 1.5)
    expect((next + 200) / 1.5).toBeCloseTo(300)
    expect(focalZoomAdjust(0, 0, 2)).toBe(0)
  })
})

describe('classifySwipe', () => {
  it('classifies fast horizontal left/right gestures', () => {
    expect(classifySwipe(-50, 5, -0.5)).toBe('left')
    expect(classifySwipe(60, -10, 0.5)).toBe('right')
  })

  it('rejects gestures below minDistance', () => {
    expect(classifySwipe(-30, 0, -1)).toBeNull()
    expect(classifySwipe(39, 0, 1)).toBeNull()
  })

  it('rejects gestures dominated by vertical motion', () => {
    // dx = -50, dy = 45 (ratio < 1.25)
    expect(classifySwipe(-50, 45, -0.5)).toBeNull()
    // dx = -50, dy = 10 (ratio 5.0 >= 1.25) -> accepted
    expect(classifySwipe(-50, 10, -0.5)).toBe('left')
  })

  it('rejects slow small gestures below minVelocity', () => {
    expect(classifySwipe(50, 0, 0.1)).toBeNull()
  })

  it('accepts slow gestures if displacement is large enough', () => {
    expect(classifySwipe(100, 0, 0.1)).toBe('right')
    expect(classifySwipe(-120, 10, -0.1)).toBe('left')
  })

  it('supports custom thresholds', () => {
    expect(classifySwipe(30, 0, 0.5, { minDistance: 20 })).toBe('right')
    expect(classifySwipe(50, 35, 0.5, { dominanceRatio: 1.1 })).toBe('right')
  })
})

describe('swipePageOffset', () => {
  it('in LTR: left swipe advances (+step), right swipe goes back (-step)', () => {
    expect(swipePageOffset('left', 'ltr', 1)).toBe(1)
    expect(swipePageOffset('right', 'ltr', 1)).toBe(-1)
    expect(swipePageOffset('left', 'ltr', 2)).toBe(2)
    expect(swipePageOffset('right', 'ltr', 2)).toBe(-2)
  })

  it('in RTL: right swipe advances (+step), left swipe goes back (-step)', () => {
    expect(swipePageOffset('right', 'rtl', 1)).toBe(1)
    expect(swipePageOffset('left', 'rtl', 1)).toBe(-1)
    expect(swipePageOffset('right', 'rtl', 2)).toBe(2)
    expect(swipePageOffset('left', 'rtl', 2)).toBe(-2)
  })

  it('defaults to step = 1', () => {
    expect(swipePageOffset('left', 'ltr')).toBe(1)
    expect(swipePageOffset('right', 'rtl')).toBe(1)
  })
})

describe('decayVelocity', () => {
  it('decays velocity exponentially over elapsed time', () => {
    const v0 = 1.0
    const v1 = decayVelocity(v0, 100)
    expect(v1).toBeLessThan(v0)
    expect(v1).toBeCloseTo(v0 * Math.exp(-0.0035 * 100))

    const v2 = decayVelocity(v0, 500)
    expect(v2).toBeLessThan(v1)
  })

  it('returns unchanged velocity when dt <= 0', () => {
    expect(decayVelocity(1.5, 0)).toBe(1.5)
    expect(decayVelocity(1.5, -10)).toBe(1.5)
  })

  it('accepts custom decay constant', () => {
    const v = decayVelocity(2.0, 50, 0.01)
    expect(v).toBeCloseTo(2.0 * Math.exp(-0.01 * 50))
  })
})

describe('panStep', () => {
  it('updates scroll position when within boundaries', () => {
    const res = panStep(100, 20, 500)
    expect(res).toEqual({ nextScroll: 120, stopped: false })
  })

  it('clamps to 0 and stops when scrolling past start', () => {
    const res = panStep(10, -30, 500)
    expect(res).toEqual({ nextScroll: 0, stopped: true })
  })

  it('clamps to maxScroll and stops when scrolling past end', () => {
    const res = panStep(480, 50, 500)
    expect(res).toEqual({ nextScroll: 500, stopped: true })
  })

  it('stops immediately if maxScroll is 0 or negative', () => {
    expect(panStep(0, 10, 0)).toEqual({ nextScroll: 0, stopped: true })
    expect(panStep(0, -10, -50)).toEqual({ nextScroll: 0, stopped: true })
  })
})
