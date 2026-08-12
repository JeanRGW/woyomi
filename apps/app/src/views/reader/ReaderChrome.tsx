import { useT } from '../../i18n'
import { Icon } from '../../icons'
import type { ReaderMode } from './reader-nav'

function ChromeBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 cursor-pointer place-items-center rounded-xl text-fg transition-colors hover:bg-surface-2 disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export function ReaderChrome({
  visible,
  title,
  chapterLabel,
  isImages,
  mode,
  onModeToggle,
  onOpenChapters,
  onOpenSettings,
  progress,
  pageLabel,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onPrevChapter,
  onNextChapter,
  hasPrev,
  hasNext
}: {
  visible: boolean
  title: string
  chapterLabel: string
  isImages: boolean
  mode: ReaderMode
  onModeToggle: () => void
  onOpenChapters: () => void
  onOpenSettings: () => void
  /** 0..1 */
  progress: number
  pageLabel: string
  /** paged-only zoom cluster; omit for text */
  zoom?: number
  onZoomIn?: () => void
  onZoomOut?: () => void
  onZoomReset?: () => void
  onPrevChapter: () => void
  onNextChapter: () => void
  hasPrev: boolean
  hasNext: boolean
}) {
  const t = useT()
  return (
    <>
      {/* top bar */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="h-0.5 bg-surface-2">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
        </div>
        <div className="pointer-events-auto flex items-center gap-1 bg-ink/85 px-2 py-1.5 backdrop-blur">
          <ChromeBtn label={t('common.back')} onClick={() => history.back()}>
            <Icon name="back" size={19} />
          </ChromeBtn>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-sm font-bold">{title}</div>
            {chapterLabel && <div className="truncate text-[11px] font-medium text-muted">{chapterLabel}</div>}
          </div>
          {isImages && (
            <button
              type="button"
              onClick={onModeToggle}
              className="min-h-9 cursor-pointer rounded-xl px-3 text-xs font-bold text-fg transition-colors hover:bg-surface-2"
            >
              {mode === 'continuous' ? t('reader.strip') : t('reader.pages')}
            </button>
          )}
          <ChromeBtn label={t('reader.chapters')} onClick={onOpenChapters}>
            <Icon name="list" size={19} />
          </ChromeBtn>
          <ChromeBtn label={t('reader.readerSettings')} onClick={onOpenSettings}>
            <Icon name="sliders" size={19} />
          </ChromeBtn>
        </div>
      </div>

      {/* bottom bar */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 transition-opacity ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="flex items-center gap-1 bg-ink/85 px-2 py-1.5 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <ChromeBtn label={t('reader.prevChapter')} onClick={onPrevChapter} disabled={!hasPrev}>
            <Icon name="chevronLeft" size={19} />
          </ChromeBtn>
          <span className="min-w-16 text-center text-xs font-bold tabular-nums text-muted">{pageLabel}</span>
          {zoom !== undefined && onZoomIn && onZoomOut && onZoomReset && (
            <span className="mx-auto flex items-center gap-0.5">
              <ChromeBtn label={t('reader.zoomOut')} onClick={onZoomOut}>
                <span className="text-base font-extrabold leading-none">−</span>
              </ChromeBtn>
              <button
                type="button"
                onClick={onZoomReset}
                title={t('reader.resetZoom')}
                className="min-h-9 min-w-12 cursor-pointer rounded-xl px-1 text-xs font-bold tabular-nums text-fg transition-colors hover:bg-surface-2"
              >
                {Math.round(zoom * 100)}%
              </button>
              <ChromeBtn label={t('reader.zoomIn')} onClick={onZoomIn}>
                <Icon name="plus" size={16} />
              </ChromeBtn>
            </span>
          )}
          {zoom === undefined && <span className="mx-auto" />}
          <ChromeBtn label={t('reader.nextChapter')} onClick={onNextChapter} disabled={!hasNext}>
            <Icon name="chevronRight" size={19} />
          </ChromeBtn>
        </div>
      </div>
    </>
  )
}
