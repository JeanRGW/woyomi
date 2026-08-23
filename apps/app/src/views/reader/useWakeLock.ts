import { useEffect } from 'react'

/** Keep the display awake while reading when the browser/WebView supports it. */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return

    let cancelled = false
    let sentinel: WakeLockSentinel | undefined

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== 'visible') return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (cancelled || document.visibilityState !== 'visible') {
          await next.release()
          return
        }
        sentinel = next
        next.addEventListener(
          'release',
          () => {
            if (sentinel === next) sentinel = undefined
          },
          { once: true }
        )
      } catch {
        // Unsupported contexts and denied requests should not interrupt reading.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquire()
        return
      }
      const current = sentinel
      sentinel = undefined
      void current?.release()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void sentinel?.release()
    }
  }, [enabled])
}
