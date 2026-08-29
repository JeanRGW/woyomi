import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import type { Media } from '@woyomi/core'
import type { DownloadState } from './downloads'
import { navigate } from './App'
import { Icon, type IconName } from './icons'
import { useT } from './i18n'
import { mediaStatusLabelKey, mediaTypeLabelKey } from './i18n/messages'
import { imageSrc } from './runtime'

/* ---------- Layout primitives ---------- */

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full px-4 pb-5 pt-0 md:px-8 md:py-8 ${wide ? 'max-w-7xl' : 'max-w-6xl'}`}>{children}</div>
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 md:mb-7">
      <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
      {children && <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">{children}</div>}
    </div>
  )
}

export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-3 first:mt-0">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted">{title}</h2>
      {action}
    </div>
  )
}

/* ---------- Controls ---------- */

type BtnVariant = 'primary' | 'soft' | 'outline' | 'danger' | 'ghost'

const btnVariants: Record<BtnVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-deep shadow-sm shadow-accent/25',
  soft: 'bg-surface-2 text-fg hover:bg-surface-3',
  outline: 'border border-line bg-transparent text-fg hover:border-accent hover:text-accent',
  danger: 'bg-danger-soft text-danger hover:bg-danger/20',
  ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-fg'
}

export function Btn({
  variant = 'soft',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all active:scale-[0.97] disabled:cursor-default disabled:opacity-40 disabled:active:scale-100 ${btnVariants[variant]} ${className}`}
      {...props}
    />
  )
}

export function Chip({ active, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold capitalize transition-all active:scale-[0.96] ${
        active ? 'bg-accent-deep text-white shadow-sm shadow-accent/25' : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg'
      } ${className}`}
      {...props}
    />
  )
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3.5 text-base text-fg placeholder:text-faint focus:border-accent focus:outline-none md:text-sm ${className}`}
      {...props}
    />
  )
}

export function SelectInput({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`min-h-10 cursor-pointer rounded-xl border border-line bg-surface-2 px-3 text-sm font-medium text-fg focus:border-accent focus:outline-none ${className}`}
      {...props}
    />
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <span
        className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

/* ---------- Feedback ---------- */

export function Banner({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  const styles =
    tone === 'error' ? 'border-danger/40 bg-danger-soft text-danger' : 'border-ok/40 bg-ok-soft text-ok'
  return <div className={`my-3 rounded-xl border px-4 py-3 text-sm font-medium ${styles}`}>{children}</div>
}

export function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Icon name={icon} size={22} />
      </div>
      <p className="font-bold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
    </div>
  )
}

export function BackButton() {
  const t = useT()
  return (
    <button
      onClick={() => (window.history.length > 1 ? window.history.back() : navigate({ name: 'library' }))}
      className="mb-4 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-surface/80 px-3.5 text-sm font-semibold text-muted backdrop-blur transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Icon name="back" size={17} />
      {t('common.back')}
    </button>
  )
}

/* ---------- Skeletons ---------- */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-2 ${className}`} aria-hidden="true" />
}

export function MediaCardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col ${className}`} aria-hidden="true">
      <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-surface-2 ring-1 ring-white/5" />
      <div className="mt-2 h-3.5 w-4/5 animate-pulse rounded bg-surface-2" />
      <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-surface-2/70" />
    </div>
  )
}

export function MediaGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <MediaGrid>
      {Array.from({ length: count }).map((_, i) => (
        <MediaCardSkeleton key={i} />
      ))}
    </MediaGrid>
  )
}

export function HomeRailSkeleton() {
  return (
    <div className="mb-6 rise-in" aria-hidden="true">
      <div className="mb-2 mt-6 h-6 w-36 animate-pulse rounded-lg bg-surface-2" />
      <div className="mb-2 mt-4 h-4 w-28 animate-pulse rounded bg-surface-2/70" />
      <div className="rail no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:-mx-8 md:px-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-[7.5rem] shrink-0 sm:w-32 md:w-36">
            <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-surface-2 ring-1 ring-white/5" />
            <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="mt-1 h-2.5 w-1/2 animate-pulse rounded bg-surface-2/70" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function MediaDetailSkeleton() {
  return (
    <div className="relative min-h-full" aria-hidden="true">
      <div className="relative mx-auto w-full max-w-4xl px-4 py-5 md:px-8 md:py-8">
        <div className="mb-4 h-10 w-24 animate-pulse rounded-xl bg-surface/80" />
        <div className="flex gap-4 md:gap-6">
          <div className="w-28 shrink-0 overflow-hidden rounded-2xl sm:w-36 md:w-44">
            <div className="aspect-[2/3] w-full animate-pulse rounded-2xl bg-surface-2 ring-1 ring-white/10" />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <div className="h-7 w-3/4 animate-pulse rounded-lg bg-surface-2 md:h-9" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <div className="h-6 w-16 animate-pulse rounded-full bg-surface-2" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-surface-2" />
              <div className="h-6 w-16 animate-pulse rounded-full bg-surface-2" />
            </div>
            <div className="mt-4 flex gap-2">
              <div className="h-10 w-36 animate-pulse rounded-xl bg-surface-2" />
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <div className="h-4 w-full animate-pulse rounded bg-surface-2/80" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2/80" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2/80" />
        </div>
        <div className="mb-3 mt-8 flex items-center justify-between">
          <div className="h-5 w-28 animate-pulse rounded bg-surface-2" />
          <div className="h-7 w-24 animate-pulse rounded-lg bg-surface-2" />
        </div>
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-xl border border-line-soft bg-surface/60" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function PluginRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-2 flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-line-soft bg-surface p-3">
          <div className="size-12 shrink-0 animate-pulse rounded-xl bg-surface-2" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
            <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-surface-2/70" />
            <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-surface-2/50" />
          </div>
          <div className="h-10 w-24 shrink-0 animate-pulse rounded-xl bg-surface-2" />
        </div>
      ))}
    </div>
  )
}

export function HistoryRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-line-soft bg-surface p-2.5">
          <div className="h-16 w-11 shrink-0 animate-pulse rounded-lg bg-surface-2" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-surface-2/70" />
            <div className="mt-2 h-2.5 w-1/4 animate-pulse rounded bg-surface-2/50" />
          </div>
          <div className="size-10 shrink-0 animate-pulse rounded-xl bg-surface-2" />
          <div className="size-10 shrink-0 animate-pulse rounded-xl bg-surface-2" />
        </div>
      ))}
    </div>
  )
}

export function DownloadRowSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-surface px-3 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
            <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-surface-2/70" />
            <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-surface-3" />
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1">
            <div className="size-10 shrink-0 animate-pulse rounded-xl bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Media ---------- */

export const TYPE_ICONS: Record<string, IconName> = {
  manga: 'bookOpen',
  anime: 'tv',
  novel: 'fileText',
  movie: 'film',
  series: 'tv'
}

const TYPE_TINTS: Record<string, string> = {
  manga: 'from-rose-500/25',
  anime: 'from-sky-500/25',
  novel: 'from-amber-500/25',
  movie: 'from-violet-500/25',
  series: 'from-emerald-500/25'
}

export function CoverArt({ media, coverUrl, className = '' }: { media: Media; coverUrl?: string; className?: string }) {
  const tint = TYPE_TINTS[media.type] ?? 'from-accent/25'
  const [failed, setFailed] = useState(false)
  // An explicit override (e.g. the local /covers/ offline URL) is already a
  // display URL — don't re-route it through the header proxy.
  const src = coverUrl !== undefined && coverUrl !== media.coverUrl ? coverUrl : imageSrc(media.coverUrl, media.coverHeaders)
  useEffect(() => setFailed(false), [src])
  if (src && !failed) {
    return <img className={`aspect-[2/3] w-full object-cover ${className}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  }
  const iconName = TYPE_ICONS[media.type] ?? 'bookOpen'
  return (
    <div
      className={`grid aspect-[2/3] w-full place-items-center bg-gradient-to-b ${tint} to-surface-2 text-muted/70 ${className}`}
    >
      <Icon name={iconName} size={32} />
    </div>
  )
}

export function MediaCard({ media, className = '' }: { media: Media; className?: string }) {
  const t = useT()
  const [srcId, mediaId] = media.id.split('/')
  const open = () => navigate({ name: 'media', sourceId: srcId!, mediaId: mediaId! })
  return (
    <div
      className={`group cursor-pointer ${className}`}
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && open()}
    >
      <div className="overflow-hidden rounded-xl ring-1 ring-white/5 transition-all duration-200 group-hover:ring-2 group-hover:ring-accent/70">
        <CoverArt media={media} className="transition-transform duration-200 group-hover:scale-[1.04]" />
      </div>
      <div className="mt-2 line-clamp-2 text-[13px] font-semibold leading-snug">{media.title}</div>
      <div className="mt-0.5 text-[11px] font-medium capitalize text-muted">
        {t(mediaTypeLabelKey(media.type))}
        {media.status ? ` · ${t(mediaStatusLabelKey(media.status))}` : ''}
      </div>
    </div>
  )
}

export function MediaGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">{children}</div>
}

export function EpisodeRow({
  label,
  active,
  onOpen,
  onToggleSeen,
  downloadState,
  onDownload
}: {
  label: string
  active: boolean
  onOpen: () => void
  onToggleSeen: () => void
  downloadState?: DownloadState
  onDownload?: () => void
}) {
  const t = useT()
  const downloadLabel =
    downloadState === 'queued'
      ? t('downloads.stateQueued')
      : downloadState === 'downloading'
        ? t('downloads.stateDownloading')
        : downloadState === 'complete'
          ? t('downloads.stateComplete')
          : t('downloads.download')
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl border border-line-soft bg-surface px-3 py-2 transition-colors hover:border-accent/50 ${
        active ? 'opacity-55' : ''
      }`}
    >
      <span
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className="min-w-0 flex-1 cursor-pointer truncate rounded-lg px-1.5 py-1.5 text-sm font-medium hover:bg-surface-2"
      >
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {active && (
          <span className="hidden items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent sm:inline-flex">
            <Icon name="check" size={12} />
            {t('common.seen')}
          </span>
        )}
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloadState === 'queued' || downloadState === 'downloading' || downloadState === 'complete'}
            title={downloadLabel}
            aria-label={downloadLabel}
            className={`grid size-9 cursor-pointer place-items-center rounded-lg transition-colors disabled:cursor-default ${
              downloadState === 'complete' ? 'text-accent' : 'text-faint hover:bg-surface-2 hover:text-fg disabled:hover:bg-transparent disabled:hover:text-faint'
            }`}
          >
            <Icon name={downloadState === 'complete' ? 'check' : 'download'} size={17} />
          </button>
        )}
        <button
          onClick={onToggleSeen}
          title={active ? t('common.markUnseen') : t('common.markSeen')}
          aria-label={active ? t('common.markUnseen') : t('common.markSeen')}
          className={`grid size-9 cursor-pointer place-items-center rounded-lg transition-colors ${
            active ? 'text-accent hover:bg-surface-2' : 'text-faint hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <Icon name={active ? 'eyeOff' : 'eye'} size={17} />
        </button>
      </span>
    </div>
  )
}
