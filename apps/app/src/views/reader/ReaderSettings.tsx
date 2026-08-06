import type { Episode } from '@media-platform/core'
import { Chip, Toggle } from '../../components'
import { Icon } from '../../icons'
import type { ReaderBackground, ReaderFit, ReaderMode, ReadingDirection } from './reader-nav'
import type { ReaderPrefs } from './reader-prefs'

function Sheet({ title, onClose, side, children }: { title: string; onClose: () => void; side: 'right' | 'bottom'; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30" role="dialog" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={
          side === 'right'
            ? 'absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col border-l border-line bg-surface'
            : 'absolute inset-x-0 bottom-0 flex max-h-[70%] flex-col rounded-t-2xl border-t border-line bg-surface'
        }
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
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
          <Chip key={o.value} active={value === o.value} onClick={() => onChange(o.value)}>
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

export function ReaderSettingsSheet({
  prefs,
  setPref,
  isImages,
  onClose
}: {
  prefs: ReaderPrefs
  setPref: <K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => void
  isImages: boolean
  onClose: () => void
}) {
  return (
    <Sheet title="Reader settings" onClose={onClose} side="right">
      {isImages && (
        <>
          <ChipRow<ReaderMode>
            label="Reading mode"
            value={prefs.mode}
            onChange={(v) => setPref('mode', v)}
            options={[
              { value: 'continuous', label: 'Strip' },
              { value: 'paged', label: 'Pages' }
            ]}
          />
          <ChipRow<ReadingDirection>
            label="Direction"
            value={prefs.mode === 'paged' ? prefs.direction : 'vertical'}
            onChange={(v) => setPref('direction', v)}
            options={
              prefs.mode === 'paged'
                ? [
                    { value: 'rtl', label: 'Right to left' },
                    { value: 'ltr', label: 'Left to right' }
                  ]
                : [{ value: 'vertical', label: 'Vertical' }]
            }
          />
          {prefs.mode === 'paged' && (
            <ChipRow<ReaderFit>
              label="Fit"
              value={prefs.fit}
              onChange={(v) => setPref('fit', v)}
              options={[
                { value: 'page', label: 'Fit screen' },
                { value: 'width', label: 'Fit width' }
              ]}
            />
          )}
        </>
      )}
      <ChipRow<ReaderBackground>
        label="Background"
        value={prefs.background}
        onChange={(v) => setPref('background', v)}
        options={[
          { value: 'ink', label: 'Ink' },
          { value: 'black', label: 'Black' },
          { value: 'sepia', label: 'Sepia' }
        ]}
      />
      {isImages && <ToggleRow label="Tap to navigate" checked={prefs.tapNav} onChange={(v) => setPref('tapNav', v)} />}
      {isImages && prefs.mode === 'continuous' && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-muted">
            <span>Strip width</span>
            <span className="tabular-nums">{prefs.stripWidth}%</span>
          </div>
          <input
            type="range"
            min={30}
            max={100}
            step={5}
            value={prefs.stripWidth}
            onChange={(e) => setPref('stripWidth', Number(e.target.value))}
            aria-label="Strip width"
            className="w-full accent-accent"
          />
        </div>
      )}
      {isImages && prefs.mode === 'paged' && (
        <ToggleRow label="Double page" checked={prefs.doublePage} onChange={(v) => setPref('doublePage', v)} />
      )}
      <ToggleRow label="Auto-advance to next chapter" checked={prefs.autoNext} onChange={(v) => setPref('autoNext', v)} />
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
  return (
    <Sheet title="Chapters" onClose={onClose} side="bottom">
      <div className="flex flex-col gap-1">
        {episodes.map((ep) => {
          const isCurrent = ep.id === currentId
          return (
            <button
              key={ep.id}
              type="button"
              onClick={() => onJump(ep)}
              className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                isCurrent ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">
                {ep.number}
                {ep.season != null ? ` · S${ep.season}` : ''}
                {ep.title ? ` — ${ep.title}` : ''}
              </span>
              {seen.has(ep.id) && <Icon name="check" size={14} className="shrink-0 text-accent" />}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
