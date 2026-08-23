import { useEffect, useId, useRef } from 'react'
import type { Episode } from '@woyomi/core'
import { useT } from '../../i18n'
import { Chip, Toggle } from '../../components'
import { Icon } from '../../icons'
import type { ReaderBackground, ReaderFit, ReaderMode, ReadingDirection } from './reader-nav'
import type { NovelFontFamily, ReaderPrefs } from './reader-prefs'

function Sheet({ title, onClose, side, children }: { title: string; onClose: () => void; side: 'right' | 'bottom'; children: React.ReactNode }) {
  const t = useT()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
  )
  onCloseRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    const returnFocus = returnFocusRef.current
    if (!panel) return

    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')
      )

    const focusRaf = requestAnimationFrame(() => (focusable()[0] ?? panel).focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (controls.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = controls[0]!
      const last = controls[controls.length - 1]!
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusRaf)
      document.removeEventListener('keydown', onKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [])

  return (
    <div className="absolute inset-0 z-30" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={
          side === 'right'
            ? 'absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col border-l border-line bg-surface'
            : 'absolute inset-x-0 bottom-0 flex max-h-[70%] flex-col rounded-t-2xl border-t border-line bg-surface'
        }
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 id={titleId} className="text-sm font-bold uppercase tracking-wider text-muted">{title}</h2>
          <button type="button" aria-label={t('common.close')} onClick={onClose} className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

function ChipRow<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-xs font-bold text-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip key={o.value} active={value === o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function SliderRow({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  valueLabel: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={valueLabel}
        className="w-full accent-accent"
      />
    </div>
  )
}

export interface ReaderSettingsSheetProps {
  prefs: ReaderPrefs
  setPref: <K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => void
  isImages: boolean
  onClose: () => void
  hasTitleOverride?: boolean
  onToggleTitleOverride?: (enabled: boolean) => void
}

export function ReaderSettingsSheet({
  prefs,
  setPref,
  isImages,
  onClose,
  hasTitleOverride,
  onToggleTitleOverride
}: ReaderSettingsSheetProps) {
  const t = useT()
  return (
    <Sheet title={t('reader.readerSettings')} onClose={onClose} side="right">
      {isImages ? (
        <>
          {onToggleTitleOverride !== undefined && (
            <ToggleRow
              label={t('reader.titleOverride')}
              checked={hasTitleOverride ?? false}
              onChange={onToggleTitleOverride}
            />
          )}
          <ChipRow<ReaderMode>
            label={t('reader.readingMode')}
            value={prefs.mode}
            onChange={(mode) => {
              const direction = mode === 'continuous' ? 'vertical' : prefs.direction === 'vertical' ? 'rtl' : prefs.direction
              if (direction !== prefs.direction) setPref('direction', direction)
              setPref('mode', mode)
            }}
            options={[
              { value: 'continuous', label: t('reader.strip') },
              { value: 'paged', label: t('reader.pages') }
            ]}
          />
          <ChipRow<ReadingDirection>
            label={t('reader.direction')}
            value={prefs.mode === 'paged' ? prefs.direction : 'vertical'}
            onChange={(v) => setPref('direction', v)}
            options={
              prefs.mode === 'paged'
                ? [
                    { value: 'rtl', label: t('reader.rightToLeft') },
                    { value: 'ltr', label: t('reader.leftToRight') }
                  ]
                : [{ value: 'vertical', label: t('reader.vertical') }]
            }
          />
          {prefs.mode === 'paged' && (
            <ChipRow<ReaderFit>
              label={t('reader.fit')}
              value={prefs.fit}
              onChange={(v) => setPref('fit', v)}
              options={[
                { value: 'page', label: t('reader.fitScreen') },
                { value: 'width', label: t('reader.fitWidth') }
              ]}
            />
          )}
        </>
      ) : (
        <>
          <ChipRow<NovelFontFamily>
            label={t('reader.fontFamily')}
            value={prefs.fontFamily}
            onChange={(v) => setPref('fontFamily', v)}
            options={[
              { value: 'serif', label: t('reader.fontSerif') },
              { value: 'sans', label: t('reader.fontSans') }
            ]}
          />
          <SliderRow
            label={t('reader.fontSize')}
            valueLabel={t('reader.fontSizeValue', { value: prefs.fontSize })}
            value={prefs.fontSize}
            min={12}
            max={32}
            step={1}
            onChange={(v) => setPref('fontSize', v)}
          />
          <SliderRow
            label={t('reader.lineHeight')}
            valueLabel={t('reader.lineHeightValue', { value: prefs.lineHeight.toFixed(1) })}
            value={prefs.lineHeight}
            min={1.2}
            max={2.6}
            step={0.1}
            onChange={(v) => setPref('lineHeight', Number(v.toFixed(1)))}
          />
          <SliderRow
            label={t('reader.columnWidth')}
            valueLabel={t('reader.columnWidthValue', { value: prefs.columnWidth })}
            value={prefs.columnWidth}
            min={40}
            max={100}
            step={2}
            onChange={(v) => setPref('columnWidth', v)}
          />
          <SliderRow
            label={t('reader.paragraphSpacing')}
            valueLabel={t('reader.paragraphSpacingValue', { value: prefs.paragraphSpacing.toFixed(1) })}
            value={prefs.paragraphSpacing}
            min={0.4}
            max={2.5}
            step={0.1}
            onChange={(v) => setPref('paragraphSpacing', Number(v.toFixed(1)))}
          />
        </>
      )}
      <ChipRow<ReaderBackground>
        label={t('reader.background')}
        value={prefs.background}
        onChange={(v) => setPref('background', v)}
        options={[
          { value: 'ink', label: t('reader.ink') },
          { value: 'black', label: t('reader.black') },
          { value: 'sepia', label: t('reader.sepia') }
        ]}
      />
      {isImages && <ToggleRow label={t('reader.tapToNavigate')} checked={prefs.tapNav} onChange={(v) => setPref('tapNav', v)} />}
      {isImages && prefs.mode === 'continuous' && (
        <SliderRow
          label={t('reader.stripWidth')}
          valueLabel={t('reader.stripWidthValue', { value: prefs.stripWidth })}
          value={prefs.stripWidth}
          min={30}
          max={100}
          step={5}
          onChange={(v) => setPref('stripWidth', v)}
        />
      )}
      {isImages && prefs.mode === 'paged' && (
        <ToggleRow label={t('reader.doublePage')} checked={prefs.doublePage} onChange={(v) => setPref('doublePage', v)} />
      )}
      <ToggleRow label={t('reader.autoAdvance')} checked={prefs.autoNext} onChange={(v) => setPref('autoNext', v)} />
      <ToggleRow label={t('reader.keepAwake')} checked={prefs.keepAwake} onChange={(v) => setPref('keepAwake', v)} />
    </Sheet>
  )
}

export function ChapterDrawer({
  episodes,
  currentId,
  seen,
  onJump,
  onClose
}: {
  episodes: Episode[]
  currentId: string
  seen: Set<string>
  onJump: (episode: Episode) => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <Sheet title={t('reader.chapters')} onClose={onClose} side="bottom">
      <div className="flex flex-col gap-1">
        {episodes.map((ep) => {
          const isCurrent = ep.id === currentId
          return (
            <button
              key={ep.id}
              type="button"
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => onJump(ep)}
              className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                isCurrent ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">
                {ep.number}
                {ep.season != null ? t('common.season', { season: ep.season }) : ''}
                {ep.title ? t('common.title', { title: ep.title }) : ''}
              </span>
              {seen.has(ep.id) && <Icon name="check" size={14} className="shrink-0 text-accent" />}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
