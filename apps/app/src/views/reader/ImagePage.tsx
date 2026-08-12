import { useState, type CSSProperties } from 'react'
import { useT } from '../../i18n'

/**
 * Page image with an inline error + tap-to-retry fallback (per-image state so
 * one bad page doesn't kill the strip).
 */
export function ReaderImage({
  src,
  alt,
  eager,
  className = '',
  style,
  onLoad,
  onError
}: {
  src: string
  alt: string
  eager?: boolean
  className?: string
  style?: CSSProperties
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void
  onError?: () => void
}) {
  const t = useT()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => {
          setAttempt((n) => n + 1)
          setFailed(false)
        }}
        className="mx-auto flex h-48 w-full max-w-md cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-sm text-muted hover:text-fg"
      >
        <span>{t('reader.pageFailed')}</span>
        <span className="text-xs font-bold text-accent">{t('reader.tapToRetry')}</span>
      </button>
    )
  }

  return (
    <img
      key={attempt}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className={className}
      style={style}
      onLoad={onLoad}
      onError={() => {
        setFailed(true)
        onError?.()
      }}
    />
  )
}
