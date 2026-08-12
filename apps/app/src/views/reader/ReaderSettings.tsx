import type { Episode } from '@woyomi/core'
import { useT } from '../../i18n'
import { Chip, Toggle } from '../../components'
import { Icon } from '../../icons'
import type { ReaderBackground, ReaderFit, ReaderMode, ReadingDirection } from './reader-nav'
import type { ReaderPrefs } from './reader-prefs'

function Sheet({ title, onClose, side, children }: { title: string; onClose: () => void; side: 'right' | 'bottom'; children: React.ReactNode }) {
  const t = useT()
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
  const t = useT()
  return (
    <Sheet title={t('reader.readerSettings')} onClose={onClose} side="right">
      {isImages && (
        <>
          <ChipRow<ReaderMode>
            label={t('reader.readingMode')}
            value={prefs.mode}
            onChange={(v) => setPref('mode', v)}
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
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-muted">
            <span>{t('reader.stripWidth')}</span>
            <span className="tabular-nums">{prefs.stripWidth}%</span>
          </div>
          <input
            type="range"
            min={30}
            max={100}
            step={5}
            value={prefs.stripWidth}
            onChange={(e) => setPref('stripWidth', Number(e.target.value))}
            aria-label={t('reader.stripWidth')}
            className="w-full accent-accent"
          />
        </div>
      )}
      {isImages && prefs.mode === 'paged' && (
        <ToggleRow label={t('reader.doublePage')} checked={prefs.doublePage} onChange={(v) => setPref('doublePage', v)} />
      )}
      <ToggleRow label={t('reader.autoAdvance')} checked={prefs.autoNext} onChange={(v) => setPref('autoNext', v)} />
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
