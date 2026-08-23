import { useEffect, useRef } from 'react'

export interface TouchReleaseInfo {
  dx: number
  dy: number
  vx: number // px/ms
  vy: number // px/ms
  moved: boolean
}

export interface TouchGestureHandlers {
  /** Called when a 2-pointer pinch gesture begins with the midpoint focus. */
  onPinchStart?(focus: { x: number; y: number }): void
  /** Pinch distance factor relative to gesture start (1 = unchanged). */
  onPinch?(factor: number, focus: { x: number; y: number }): void
  /** Called on any pointer down (e.g. to interrupt active momentum flings). */
  onPointerDown?(): void
  /** Single-pointer drag delta since the previous move event. */
  onPan?(dx: number, dy: number): void
  /** Called when single-pointer interaction ends, with total displacement and release velocity. */
  onRelease?(info: TouchReleaseInfo): void
}

const TAP_SLOP_PX = 8

/**
 * Pointer-events pinch + pan + release tracker for paged reader.
 * Handles two-pointer midpoint zoom and single-pointer velocity tracking.
 */
export function useTouchGestures<T extends HTMLElement>(
  dom: React.RefObject<T | null>,
  handlers: TouchGestureHandlers
): { moved: React.RefObject<boolean> } {
  const moved = useRef(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const el = dom.current
    if (!el) return

    const pointers = new Map<number, { x: number; y: number }>()
    let startDist = 0
    let focus = { x: 0, y: 0 }
    let travel = 0
    let isPinching = false

    let startX = 0
    let startY = 0
    let lastMoveTime = 0
    let moveSamples: Array<{ x: number; y: number; time: number }> = []

    const dist = (): number => {
      const [a, b] = [...pointers.values()]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }

    const onPointerDown = (e: PointerEvent) => {
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // ignore capture errors in unsupported environments
      }

      handlersRef.current.onPointerDown?.()

      const now = performance.now()
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.size === 1) {
        travel = 0
        moved.current = false
        startX = e.clientX
        startY = e.clientY
        lastMoveTime = now
        moveSamples = [{ x: e.clientX, y: e.clientY, time: now }]
      } else if (pointers.size === 2) {
        isPinching = true
        startDist = dist()
        const [p1, p2] = [...pointers.values()]
        if (p1 && p2) {
          const midX = (p1.x + p2.x) / 2
          const midY = (p1.y + p2.y) / 2
          const rect = el.getBoundingClientRect()
          focus = { x: midX - rect.left, y: midY - rect.top }
          handlersRef.current.onPinchStart?.(focus)
        }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      travel += Math.abs(dx) + Math.abs(dy)
      if (travel > TAP_SLOP_PX) moved.current = true

      const now = performance.now()
      lastMoveTime = now

      if (pointers.size === 2 && startDist > 0) {
        handlersRef.current.onPinch?.(dist() / startDist, focus)
      } else if (pointers.size === 1 && !isPinching) {
        moveSamples.push({ x: e.clientX, y: e.clientY, time: now })
        while (moveSamples.length > 0 && now - moveSamples[0]!.time > 100) {
          moveSamples.shift()
        }
        if (moved.current) {
          handlersRef.current.onPan?.(dx, dy)
        }
      }
    }

    const onPointerEnd = (e: PointerEvent, cancelled = false) => {
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      const prev = pointers.get(e.pointerId)
      const currentX = prev ? prev.x : e.clientX
      const currentY = prev ? prev.y : e.clientY

      pointers.delete(e.pointerId)

      if (cancelled) {
        pointers.clear()
        isPinching = false
        startDist = 0
        moveSamples = []
        moved.current = true
        return
      }

      if (pointers.size === 0) {
        const now = performance.now()
        if (!isPinching) {
          const totalDx = currentX - startX
          const totalDy = currentY - startY
          let vx = 0
          let vy = 0
          if (now - lastMoveTime <= 80 && moveSamples.length > 0) {
            const oldest = moveSamples[0]!
            const sampleDt = now - oldest.time
            if (sampleDt > 10) {
              vx = (currentX - oldest.x) / sampleDt
              vy = (currentY - oldest.y) / sampleDt
            }
          }

          handlersRef.current.onRelease?.({
            dx: totalDx,
            dy: totalDy,
            vx,
            vy,
            moved: moved.current
          })
        }
        isPinching = false
        startDist = 0
        moveSamples = []
      } else if (pointers.size === 1) {
        startDist = 0
        const [remaining] = [...pointers.values()]
        if (remaining) {
          startX = remaining.x
          startY = remaining.y
          lastMoveTime = performance.now()
          moveSamples = [{ x: remaining.x, y: remaining.y, time: lastMoveTime }]
        }
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerEnd)
    const onPointerCancel = (event: PointerEvent) => onPointerEnd(event, true)
    el.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [dom])

  return { moved }
}
