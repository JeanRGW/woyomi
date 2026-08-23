import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { useMediaQuery } from '../../hooks'
import type { ReaderPrefs } from './reader-prefs'
import { NOVEL_FONT_FAMILIES, NOVEL_FOREGROUNDS } from './reader-prefs'
import { ignoreReaderKey } from './reader-keyboard'

export interface NovelSeekRequest {
  progress: number
  requestId: number
}

export interface NovelReaderProps {
  html: string
  initialProgress?: number
  prefs: ReaderPrefs
  keyboardEnabled?: boolean
  seek?: NovelSeekRequest
  onProgressChange?: (progress: number) => void
  onToggleChrome?: () => void
}

export function NovelReader({
  html,
  initialProgress,
  prefs,
  keyboardEnabled = true,
  seek,
  onProgressChange,
  onToggleChrome
}: NovelReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const restoredRef = useRef(false)
  const userInteractedRef = useRef(false)
  const lastReportedProgressRef = useRef<number>(-1)
  const scrollRafRef = useRef<number | null>(null)
  const lastSeekRequestIdRef = useRef<number | null>(null)
  const typographyKey = `${prefs.fontFamily}:${prefs.fontSize}:${prefs.lineHeight}:${prefs.columnWidth}:${prefs.paragraphSpacing}`
  const lastTypographyKeyRef = useRef(typographyKey)

  useEffect(() => {
    restoredRef.current = false
    userInteractedRef.current = false
  }, [html])

  // Font metrics and column width change scrollHeight. Keep the same logical
  // position instead of preserving a now-unrelated pixel offset.
  useLayoutEffect(() => {
    if (lastTypographyKeyRef.current === typographyKey) return
    lastTypographyKeyRef.current = typographyKey
    userInteractedRef.current = true
    const el = containerRef.current
    if (!el) return
    const progress = lastReportedProgressRef.current >= 0 ? lastReportedProgressRef.current : (initialProgress ?? 0)
    const clamped = Math.min(1, Math.max(0, progress))
    el.scrollTop = Math.round(clamped * Math.max(0, el.scrollHeight - el.clientHeight))
    lastReportedProgressRef.current = clamped
    onProgressChange?.(clamped)
  }, [typographyKey, initialProgress, onProgressChange])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let pointer: { id: number; x: number; y: number } | undefined
    const onPointerDown = (event: PointerEvent) => {
      if (event.isPrimary) pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) userInteractedRef.current = true
    }
    const onPointerEnd = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = undefined
    }
    const onWheel = () => {
      userInteractedRef.current = true
    }
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('pointermove', onPointerMove, { passive: true })
    el.addEventListener('pointerup', onPointerEnd, { passive: true })
    el.addEventListener('pointercancel', onPointerEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Restore immediately, then keep the normalized anchor through late font or
  // embedded-image layout for a short window unless the reader takes control.
  useEffect(() => {
    if (userInteractedRef.current) return
    const el = containerRef.current
    if (!el) return

    if (typeof initialProgress !== 'number' || initialProgress <= 0 || initialProgress >= 0.99) {
      restoredRef.current = true
      return
    }

    const attemptRestore = () => {
      if (userInteractedRef.current || !el) return
      const maxScroll = el.scrollHeight - el.clientHeight
      if (maxScroll > 0) {
        el.scrollTop = Math.round(initialProgress * maxScroll)
        restoredRef.current = true
        lastReportedProgressRef.current = initialProgress
      }
    }

    attemptRestore()
    let secondRafId: number | undefined
    const rafId = requestAnimationFrame(() => {
      attemptRestore()
      if (!restoredRef.current) {
        secondRafId = requestAnimationFrame(attemptRestore)
      }
    })

    const ro = new ResizeObserver(() => {
      attemptRestore()
    })
    ro.observe(articleRef.current ?? el)
    const settleTimeout = window.setTimeout(() => ro.disconnect(), 2000)

    return () => {
      cancelAnimationFrame(rafId)
      if (secondRafId !== undefined) cancelAnimationFrame(secondRafId)
      window.clearTimeout(settleTimeout)
      ro.disconnect()
    }
  }, [html, initialProgress])

  // Seek on request
  useEffect(() => {
    if (!seek || seek.requestId === lastSeekRequestIdRef.current) return
    lastSeekRequestIdRef.current = seek.requestId
    userInteractedRef.current = true
    restoredRef.current = true

    const el = containerRef.current
    if (!el) return
    const maxScroll = el.scrollHeight - el.clientHeight
    const targetProgress = Math.min(1, Math.max(0, seek.progress))
    el.scrollTop = Math.round(targetProgress * maxScroll)
    lastReportedProgressRef.current = targetProgress
    onProgressChange?.(targetProgress)
  }, [seek, onProgressChange])

  // RAF-throttled scroll progress
  const handleScroll = () => {
    if (!restoredRef.current) {
      restoredRef.current = true
    }

    if (scrollRafRef.current !== null) return

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const el = containerRef.current
      if (!el) return
      const maxScroll = el.scrollHeight - el.clientHeight
      const progress = maxScroll > 0 ? Math.min(1, Math.max(0, el.scrollTop / maxScroll)) : 0
      if (Math.abs(progress - lastReportedProgressRef.current) > 0.001 || progress === 0 || progress === 1) {
        lastReportedProgressRef.current = progress
        onProgressChange?.(progress)
      }
    })
  }

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [])

  // Keyboard navigation
  useEffect(() => {
    if (!keyboardEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (ignoreReaderKey(e)) return

      const el = containerRef.current
      if (!el) return

      const pageDelta = Math.max(100, el.clientHeight * 0.85)
      const lineDelta = 48

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          userInteractedRef.current = true
          el.scrollBy({ top: lineDelta, behavior: reducedMotion ? 'auto' : 'smooth' })
          break
        case 'ArrowUp':
          e.preventDefault()
          userInteractedRef.current = true
          el.scrollBy({ top: -lineDelta, behavior: reducedMotion ? 'auto' : 'smooth' })
          break
        case 'PageDown':
          e.preventDefault()
          userInteractedRef.current = true
          el.scrollBy({ top: pageDelta, behavior: reducedMotion ? 'auto' : 'smooth' })
          break
        case 'PageUp':
          e.preventDefault()
          userInteractedRef.current = true
          el.scrollBy({ top: -pageDelta, behavior: reducedMotion ? 'auto' : 'smooth' })
          break
        case ' ':
          e.preventDefault()
          userInteractedRef.current = true
          el.scrollBy({ top: e.shiftKey ? -pageDelta : pageDelta, behavior: reducedMotion ? 'auto' : 'smooth' })
          break
        case 'Home':
          e.preventDefault()
          userInteractedRef.current = true
          el.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
          break
        case 'End':
          e.preventDefault()
          userInteractedRef.current = true
          el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [keyboardEnabled, reducedMotion])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return

    const target = e.target as HTMLElement | null
    if (target?.closest('a, button, input, textarea, select, details, [role="button"], [contenteditable="true"]')) {
      return
    }

    onToggleChrome?.()
  }

  const containerStyle: CSSProperties = {
    '--novel-font-family': NOVEL_FONT_FAMILIES[prefs.fontFamily] ?? NOVEL_FONT_FAMILIES.serif,
    '--novel-font-size': `${prefs.fontSize}px`,
    '--novel-line-height': `${prefs.lineHeight}`,
    '--novel-column-width': `${prefs.columnWidth}ch`,
    '--novel-paragraph-spacing': `${prefs.paragraphSpacing}em`,
    '--novel-fg': NOVEL_FOREGROUNDS[prefs.background] ?? NOVEL_FOREGROUNDS.ink,
    touchAction: 'pan-y'
  } as CSSProperties

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="novel-reader h-full overflow-y-auto overscroll-contain"
      style={containerStyle}
      onClick={handleClick}
      onScroll={handleScroll}
    >
      <article ref={articleRef} className="novel-body mx-auto px-4 py-12" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
