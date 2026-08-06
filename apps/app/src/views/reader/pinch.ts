import { useEffect, useRef } from 'react'

export interface TouchGestureHandlers {
  /** Pinch distance factor relative to gesture start (1 = unchanged). */
  onPinch?(factor: number, focus: { x: number; y: number }): void
  /** Single-pointer drag delta since the previous move event. */
  onPan?(dx: number, dy: number): void
}

export interface TouchGestures<T extends HTMLElement> {
  ref: React.RefObject<T | null>
  /** true once a gesture moved past the tap slop; click handlers should no-op. */
  moved: React.RefObject<boolean>
}

const TAP_SLOP_PX = 8

/**
 * Pointer-events pinch + pan. ponytail: no inertia/fling — the containers use
 * native overflow scroll, which already has it; add a velocity tracker only if
 * pans feel dead.
 */
export function useTouchGestures<T extends HTMLElement>(handlers: TouchGestureHandlers): TouchGestures<T> {
  const ref = useRef<T>(null)
  const moved = useRef(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const pointers = new Map<number, { x: number; y: number }>()
    let startDist = 0
    let focus = { x: 0, y: 0 }
    let travel = 0

    const dist = (): number => {
      const [a, b] = [...pointers.values()]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }

    const onPointerDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      travel = 0
      moved.current = false
      if (pointers.size === 2) {
        startDist = dist()
        const rect = el.getBoundingClientRect()
        focus = { x: e.clientX - rect.left, y: e.clientY - rect.top }
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

      if (pointers.size === 2 && startDist > 0) {
        handlersRef.current.onPinch?.(dist() / startDist, focus)
      } else if (pointers.size === 1 && moved.current) {
        handlersRef.current.onPan?.(dx, dy)
      }
    }

    const onPointerEnd = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) startDist = 0
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerEnd)
    el.addEventListener('pointercancel', onPointerEnd)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [])

  return { ref, moved }
}
