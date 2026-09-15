import type { Episode } from '@woyomi/core'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Toggle } from '../../components'
import { useT } from '../../i18n'
import { Icon, type IconName } from '../../icons'
import type { PlayerFit } from './player-prefs'
import { formatTime } from './player-state'

export type PlayerMenu = 'quality' | 'speed' | 'captions' | 'audio' | 'episodes' | 'settings'

export interface PlayerOption {
  value: string
  label: string
}

export interface PlayerControlsState {
  visible: boolean
  locked: boolean
  lockHintVisible: boolean
  unlockDistance: number
  title: string
  episodeLabel: string
  offline: boolean
  paused: boolean
  buffering: boolean
  ended: boolean
  currentTime: number
  duration: number
  seekStart: number
  seekEnd: number
  canSeek: boolean
  bufferedEnd: number
  isLive: boolean
  behindLive: boolean
  volume: number
  muted: boolean
  playbackRate: number
  fit: PlayerFit
  autoNext: boolean
  autoRotate: boolean
  menu?: PlayerMenu
  qualityLabel: string
  qualityOptions: PlayerOption[]
  selectedQuality: string
  subtitleOptions: PlayerOption[]
  selectedSubtitle: string
  audioOptions: PlayerOption[]
  selectedAudio: string
  episodes: Episode[]
  currentEpisodeId: string
  downloadedEpisodeIds: Set<string>
  hasPrevious: boolean
  hasNext: boolean
  nextUnavailableOffline: boolean
  /** Playback failed and another source/quality is worth offering. */
  canChooseSource: boolean
  /** Menu that lists the alternative sources/qualities for the error screen. */
  sourceMenu: PlayerMenu
  canUsePictureInPicture: boolean
  inPictureInPicture: boolean
  canUseFullscreen: boolean
  inFullscreen: boolean
  resumeTime?: string
  seekFeedback?: string
  fatalError?: string
  autoNextSeconds?: number
}

export interface PlayerControlsActions {
  back(): void
  showControls(): void
  togglePlayback(): void
  replay(): void
  seekBy(seconds: number): void
  seekTo(seconds: number): void
  previewSeek(seconds: number): void
  cancelSeekPreview(): void
  jumpToLive(): void
  setVolume(volume: number): void
  toggleMuted(): void
  setPlaybackRate(rate: number): void
  setFit(fit: PlayerFit): void
  setAutoNext(enabled: boolean): void
  setAutoRotate(enabled: boolean): void
  setMenu(menu?: PlayerMenu): void
  selectQuality(value: string): void
  selectSubtitle(value: string): void
  selectAudio(value: string): void
  previousEpisode(): void
  nextEpisode(): void
  openEpisode(episode: Episode): void
  togglePictureInPicture(): void
  toggleFullscreen(): void
  lock(): void
  retry(): void
  startOver(): void
  cancelAutoNext(): void
  onUnlockPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void
  onUnlockPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void
  onUnlockPointerUp(event: ReactPointerEvent<HTMLButtonElement>): void
  onUnlockPointerCancel(event: ReactPointerEvent<HTMLButtonElement>): void
  onUnlockKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void
}

function useDialogFocus(): React.RefObject<HTMLDivElement> {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    if (!dialog) return
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([data-dialog-backdrop]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ))
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return dialogRef
}

function ChromeButton({
  label,
  icon,
  active,
  disabled,
  className = '',
  onClick,
  children
}: {
  label: string
  icon?: IconName
  active?: boolean
  disabled?: boolean
  className?: string
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-player-control
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`player-control-button grid min-h-10 min-w-10 cursor-pointer place-items-center rounded-xl px-2 text-sm font-extrabold text-white transition-colors hover:bg-white/15 active:bg-white/20 disabled:cursor-default disabled:opacity-30 ${
        active ? 'bg-accent/80' : ''
      } ${className}`}
    >
      {icon ? <Icon name={icon} size={21} /> : children}
    </button>
  )
}

function OptionsPanel({
  title,
  options,
  selected,
  onSelect,
  onClose
}: {
  title: string
  options: PlayerOption[]
  selected: string
  onSelect: (value: string) => void
  onClose: () => void
}) {
  const t = useT()
  const dialogRef = useDialogFocus()
  return (
    <div ref={dialogRef} className="absolute inset-0 z-40" data-player-control role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" tabIndex={-1} data-dialog-backdrop aria-label={t('common.close')} onClick={onClose} className="absolute inset-0 cursor-default bg-black/45" />
      <div className="absolute inset-x-0 bottom-0 ml-[var(--sal)] mr-[var(--sar)] max-h-[78%] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-surface/95 p-3 pb-[calc(var(--sab)+0.75rem)] shadow-2xl backdrop-blur-xl sm:bottom-16 sm:left-auto sm:right-[calc(var(--sar)+0.75rem)] sm:ml-0 sm:mr-0 sm:w-72 sm:rounded-2xl sm:border sm:pb-3">
        <div className="mb-2 flex items-center justify-between px-2 py-1">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted">{title}</h2>
          <ChromeButton label={t('common.close')} icon="x" onClick={onClose} />
        </div>
        <div className="flex flex-col gap-1">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm font-bold transition-colors ${
                option.value === selected ? 'bg-accent text-white' : 'text-fg hover:bg-white/10'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === selected && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function EpisodePanel({ state, actions }: { state: PlayerControlsState; actions: PlayerControlsActions }) {
  const t = useT()
  const dialogRef = useDialogFocus()
  return (
    <div ref={dialogRef} className="absolute inset-0 z-40" data-player-control role="dialog" aria-modal="true" aria-label={t('player.episodes')}>
      <button type="button" tabIndex={-1} data-dialog-backdrop aria-label={t('common.close')} onClick={() => actions.setMenu()} className="absolute inset-0 cursor-default bg-black/45" />
      <div className="absolute inset-x-0 bottom-0 ml-[var(--sal)] mr-[var(--sar)] flex max-h-[78%] flex-col rounded-t-2xl border-t border-white/10 bg-surface/95 pb-[var(--sab)] shadow-2xl backdrop-blur-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:ml-0 sm:w-96 sm:rounded-none sm:border-l sm:border-t-0 sm:pb-0">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted">{t('player.episodes')}</h2>
          <ChromeButton label={t('common.close')} icon="x" onClick={() => actions.setMenu()} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {state.episodes.map((episode) => {
            const current = episode.id === state.currentEpisodeId
            const downloaded = state.downloadedEpisodeIds.has(episode.id)
            const unavailableOffline = state.offline && !downloaded && !current
            return (
              <button
                key={episode.id}
                type="button"
                disabled={unavailableOffline}
                aria-current={current ? 'true' : undefined}
                onClick={() => (current ? actions.setMenu() : actions.openEpisode(episode))}
                className={`mb-1 flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm font-bold transition-colors ${
                  current ? 'bg-accent text-white' : 'hover:bg-white/10'
                } disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {t('common.episode', { number: episode.number })}
                  {episode.season != null ? t('common.season', { season: episode.season }) : ''}
                  {episode.title ? t('common.title', { title: episode.title }) : ''}
                </span>
                {downloaded && <Icon name="download" size={15} className={current ? 'text-white' : 'text-accent'} />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SettingsPanel({ state, actions }: { state: PlayerControlsState; actions: PlayerControlsActions }) {
  const t = useT()
  const dialogRef = useDialogFocus()
  const menuItems: Array<{ menu: PlayerMenu; label: string; value?: string }> = [
    ...(state.subtitleOptions.length > 1 ? [{ menu: 'captions' as const, label: t('player.captions'), value: state.selectedSubtitle === 'off' ? t('player.captionsOff') : state.subtitleOptions.find((option) => option.value === state.selectedSubtitle)?.label }] : []),
    ...(state.audioOptions.length > 1 ? [{ menu: 'audio' as const, label: t('player.audio'), value: state.audioOptions.find((option) => option.value === state.selectedAudio)?.label }] : []),
    { menu: 'speed', label: t('player.speed'), value: `${state.playbackRate}x` },
    ...(state.qualityOptions.length > 0 ? [{ menu: 'quality' as const, label: t('player.quality'), value: state.qualityLabel }] : [])
  ]
  return (
    <div ref={dialogRef} className="absolute inset-0 z-40" data-player-control role="dialog" aria-modal="true" aria-label={t('player.settings')}>
      <button type="button" tabIndex={-1} data-dialog-backdrop aria-label={t('common.close')} onClick={() => actions.setMenu()} className="absolute inset-0 cursor-default bg-black/45" />
      <div className="absolute inset-x-0 bottom-0 ml-[var(--sal)] mr-[var(--sar)] rounded-t-2xl border-t border-white/10 bg-surface/95 p-4 pb-[calc(var(--sab)+1rem)] shadow-2xl backdrop-blur-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:ml-0 sm:w-80 sm:rounded-none sm:border-l sm:border-t-0 sm:pb-4">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted">{t('player.settings')}</h2>
          <ChromeButton label={t('common.close')} icon="x" onClick={() => actions.setMenu()} />
        </div>
        <div className="mb-5 flex flex-col gap-1">
          {menuItems.map((item) => (
            <button
              key={item.menu}
              type="button"
              onClick={() => actions.setMenu(item.menu)}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-sm font-bold hover:bg-white/10"
            >
              <span className="flex-1">{item.label}</span>
              {item.value && <span className="max-w-32 truncate text-xs text-muted">{item.value}</span>}
              <Icon name="chevronRight" size={16} className="text-muted" />
            </button>
          ))}
        </div>
        <div className="mb-5">
          <div className="mb-2 text-xs font-bold text-muted">{t('player.fit')}</div>
          <div className="grid grid-cols-2 gap-2">
            {(['contain', 'cover'] as const).map((fit) => (
              <button
                key={fit}
                type="button"
                onClick={() => actions.setFit(fit)}
                className={`min-h-11 rounded-xl px-3 text-sm font-bold ${state.fit === fit ? 'bg-accent text-white' : 'bg-white/8 hover:bg-white/12'}`}
              >
                {t(fit === 'contain' ? 'player.fitScreen' : 'player.fitCrop')}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4 flex items-center justify-between gap-4 text-sm font-bold">
          <span>{t('player.autoNext')}</span>
          <Toggle checked={state.autoNext} onChange={actions.setAutoNext} label={t('player.autoNext')} />
        </div>
        <div className="flex items-center justify-between gap-4 text-sm font-bold">
          <span>{t('player.autoRotate')}</span>
          <Toggle checked={state.autoRotate} onChange={actions.setAutoRotate} label={t('player.autoRotate')} />
        </div>
      </div>
    </div>
  )
}

function LockedChrome({ state, actions }: { state: PlayerControlsState; actions: PlayerControlsActions }) {
  const t = useT()
  const progress = Math.min(1, state.unlockDistance / 72)
  const sliderOpacity = state.unlockDistance > 0 ? 'opacity-80' : state.lockHintVisible ? 'opacity-35' : 'opacity-15'
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className={`absolute transition-opacity hover:opacity-80 focus-within:opacity-100 ${sliderOpacity}`}
        style={{ left: 'calc(var(--sal) + 24px)', top: 'calc(var(--sat) + 16px)' }}
      >
        <div
          className={`absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent/60 transition-opacity ${state.lockHintVisible ? 'opacity-100' : 'opacity-45'}`}
          style={{ width: `${Math.max(48, state.unlockDistance + 24)}px` }}
        />
        <button
          type="button"
          data-player-control
          aria-label={t('player.unlock')}
          title={t('player.swipeToUnlock')}
          onPointerDown={actions.onUnlockPointerDown}
          onPointerMove={actions.onUnlockPointerMove}
          onPointerUp={actions.onUnlockPointerUp}
          onPointerCancel={actions.onUnlockPointerCancel}
          onKeyDown={actions.onUnlockKeyDown}
          className="pointer-events-auto relative grid size-12 touch-none cursor-grab place-items-center rounded-2xl border border-white/15 bg-black/65 text-white shadow-xl backdrop-blur active:cursor-grabbing"
          style={{ transform: `translateX(${Math.min(96, state.unlockDistance)}px)` }}
        >
          <Icon name={progress >= 1 ? 'unlock' : 'lock'} size={21} />
        </button>
        <div
          className={`pointer-events-none absolute left-14 top-1/2 w-36 -translate-y-1/2 text-xs font-bold text-white/80 transition-opacity ${
            state.lockHintVisible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transform: `translate(${Math.min(96, state.unlockDistance)}px, -50%)` }}
        >
          {t('player.swipeToUnlock')}
        </div>
      </div>
    </div>
  )
}

export function PlayerControls({ state, actions }: { state: PlayerControlsState; actions: PlayerControlsActions }) {
  const t = useT()
  const timelineScrubbingRef = useRef(false)
  if (state.locked) return <LockedChrome state={state} actions={actions} />

  const seekSpan = state.seekEnd - state.seekStart
  const timelineValue = state.canSeek ? Math.min(state.seekEnd, Math.max(state.seekStart, state.currentTime)) : 0
  const playedPercent = state.canSeek ? Math.min(100, Math.max(0, ((timelineValue - state.seekStart) / seekSpan) * 100)) : 0
  const bufferedPercent = state.canSeek ? Math.min(100, Math.max(0, ((Math.max(state.seekStart, state.bufferedEnd) - state.seekStart) / seekSpan) * 100)) : 0
  const rangeBackground = `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${playedPercent}%, rgba(255,255,255,.32) ${playedPercent}%, rgba(255,255,255,.32) ${Math.max(playedPercent, bufferedPercent)}%, rgba(255,255,255,.16) ${Math.max(playedPercent, bufferedPercent)}%, rgba(255,255,255,.16) 100%)`

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {state.fatalError
          ? state.fatalError
          : state.buffering
            ? t('player.buffering')
            : state.ended
              ? t('player.endedStatus')
              : state.paused
                ? t('player.pausedStatus')
                : t('player.playing')}
      </span>
      {state.visible && (
        <div className="absolute inset-0 z-20">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 via-black/5 to-black/80" />

          <div
            data-player-control
            className="absolute inset-x-0 top-0 flex items-center gap-1.5 px-2 pb-8 pt-2 sm:px-3"
            style={{ paddingTop: 'calc(var(--sat) + 0.5rem)', paddingLeft: 'calc(var(--sal) + 0.5rem)', paddingRight: 'calc(var(--sar) + 0.5rem)' }}
          >
            <ChromeButton label={t('common.back')} icon="back" onClick={actions.back} />
            <div className="min-w-0 flex-1 px-1">
              <div className="truncate text-sm font-extrabold text-white sm:text-base">{state.title}</div>
              <div className="flex items-center gap-2 truncate text-[11px] font-bold text-white/65 sm:text-xs">
                <span className="truncate">{state.episodeLabel}</span>
                {state.offline && <span className="shrink-0 rounded-full bg-accent/80 px-2 py-0.5 text-[9px] uppercase tracking-wider text-white">{t('player.offline')}</span>}
              </div>
            </div>
            <ChromeButton label={t('player.lock')} icon="lock" onClick={actions.lock} />
            <ChromeButton label={t('player.settings')} icon="sliders" onClick={() => actions.setMenu('settings')} />
          </div>

          {!state.ended && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="pointer-events-auto flex items-center gap-4 sm:gap-7">
                <ChromeButton label={t('player.seekBack', { seconds: 10 })} icon="rewind" className="size-12 rounded-2xl bg-black/25 sm:size-14" onClick={() => actions.seekBy(-10)} />
                <button
                  type="button"
                  data-player-control
                  aria-label={state.buffering ? t('player.buffering') : state.paused ? t('player.play') : t('player.pause')}
                  onClick={actions.togglePlayback}
                  className="grid size-16 cursor-pointer place-items-center rounded-full bg-white text-black shadow-2xl transition-transform hover:scale-105 active:scale-95 sm:size-20"
                >
                  {state.buffering ? (
                    <span className="size-7 animate-spin rounded-full border-[3px] border-black/20 border-t-black" />
                  ) : (
                    <Icon name={state.paused ? 'play' : 'pause'} size={state.paused ? 30 : 27} />
                  )}
                </button>
                <ChromeButton label={t('player.seekForward', { seconds: 10 })} icon="forward" className="size-12 rounded-2xl bg-black/25 sm:size-14" onClick={() => actions.seekBy(10)} />
              </div>
            </div>
          )}

          <div
            data-player-control
            className="absolute inset-x-0 bottom-0 px-3 pb-2 pt-10 sm:px-4"
            style={{ paddingBottom: 'calc(var(--sab) + 0.5rem)', paddingLeft: 'calc(var(--sal) + 0.75rem)', paddingRight: 'calc(var(--sar) + 0.75rem)' }}
          >
            <div className="mb-1 flex items-center gap-3">
              <span className="w-12 text-right text-[11px] font-bold tabular-nums text-white/85">{formatTime(state.currentTime, state.duration)}</span>
              <input
                type="range"
                min={state.canSeek ? state.seekStart : 0}
                max={state.canSeek ? state.seekEnd : 1}
                step={0.1}
                value={timelineValue}
                disabled={!state.canSeek}
                onPointerDown={(event) => {
                  timelineScrubbingRef.current = true
                  event.currentTarget.setPointerCapture(event.pointerId)
                  actions.previewSeek(Number(event.currentTarget.value))
                }}
                onInput={(event) => {
                  const target = Number(event.currentTarget.value)
                  if (timelineScrubbingRef.current) actions.previewSeek(target)
                  else actions.seekTo(target)
                }}
                onPointerUp={(event) => {
                  if (!timelineScrubbingRef.current) return
                  timelineScrubbingRef.current = false
                  actions.seekTo(Number(event.currentTarget.value))
                }}
                onPointerCancel={() => {
                  timelineScrubbingRef.current = false
                  actions.cancelSeekPreview()
                }}
                aria-label={t('player.timeline')}
                aria-valuetext={formatTime(state.currentTime, state.duration)}
                className="player-timeline min-w-0 flex-1"
                style={{ backgroundImage: rangeBackground }}
              />
              {state.isLive && state.behindLive ? (
                <button type="button" onClick={actions.jumpToLive} className="w-12 cursor-pointer text-[10px] font-extrabold tracking-wider text-accent hover:text-white" aria-label={t('player.jumpToLive')}>
                  {t('player.live')}
                </button>
              ) : (
                <span className={`w-12 text-[11px] font-bold tabular-nums ${state.isLive ? 'text-red-400' : 'text-white/85'}`}>
                  {state.isLive ? t('player.live') : formatTime(state.duration)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1">
              <ChromeButton label={t('player.previousEpisode')} icon="skipBack" disabled={!state.hasPrevious} onClick={actions.previousEpisode} />
              <ChromeButton label={t('player.nextEpisode')} icon="skipForward" disabled={!state.hasNext} onClick={actions.nextEpisode} />
              <ChromeButton label={state.muted ? t('player.unmute') : t('player.mute')} icon={state.muted ? 'volumeOff' : 'volume'} className="hidden sm:grid" onClick={actions.toggleMuted} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={state.muted ? 0 : state.volume}
                onChange={(event) => actions.setVolume(Number(event.target.value))}
                aria-label={t('player.volume')}
                aria-valuetext={`${Math.round((state.muted ? 0 : state.volume) * 100)}%`}
                className="player-volume hidden w-20 lg:block"
              />
              <span className="flex-1" />
              <ChromeButton label={t('player.episodes')} icon="list" onClick={() => actions.setMenu('episodes')} />
              {state.subtitleOptions.length > 1 && <ChromeButton label={t('player.captions')} icon="captions" active={state.selectedSubtitle !== 'off'} className="hidden sm:grid" onClick={() => actions.setMenu('captions')} />}
              {state.audioOptions.length > 1 && <ChromeButton label={t('player.audio')} icon="audio" className="hidden sm:grid" onClick={() => actions.setMenu('audio')} />}
              <ChromeButton label={t('player.speed')} onClick={() => actions.setMenu('speed')}>
                {state.playbackRate}x
              </ChromeButton>
              {state.qualityOptions.length > 0 && (
                <ChromeButton label={t('player.quality')} onClick={() => actions.setMenu('quality')}>
                  <span className="max-w-14 truncate text-[11px]">{state.qualityLabel}</span>
                </ChromeButton>
              )}
              {state.canUsePictureInPicture && <ChromeButton label={t('player.pictureInPicture')} icon="pip" active={state.inPictureInPicture} className="hidden md:grid" onClick={actions.togglePictureInPicture} />}
              {state.canUseFullscreen && <ChromeButton label={state.inFullscreen ? t('player.exitFullscreen') : t('player.fullscreen')} icon={state.inFullscreen ? 'minimize' : 'maximize'} onClick={actions.toggleFullscreen} />}
            </div>
          </div>
        </div>
      )}

      {state.seekFeedback && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 translate-y-16 rounded-full bg-black/70 px-4 py-2 text-sm font-extrabold text-white backdrop-blur" role="status">
          {state.seekFeedback}
        </div>
      )}

      {state.resumeTime && (
        <div className="absolute bottom-[calc(var(--sab)+5.5rem)] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-black/75 px-4 py-2 text-xs font-bold text-white backdrop-blur" data-player-control role="status">
          <span>{t('player.resumedAt', { time: state.resumeTime })}</span>
          <button type="button" onClick={actions.startOver} className="cursor-pointer text-accent hover:underline">{t('player.startOver')}</button>
        </div>
      )}

      {state.fatalError && (
        <div className="absolute inset-0 z-30 grid bg-black/65 px-5" data-player-control role="alert">
          <div className="m-auto flex max-w-sm flex-col items-center gap-4 text-center">
            <Icon name="refresh" size={30} className="text-danger" />
            <p className="text-sm font-bold text-white">{state.fatalError}</p>
            <div className="flex gap-2">
              <button type="button" onClick={actions.retry} className="min-h-11 rounded-xl bg-accent px-5 text-sm font-bold text-white">{t('player.retry')}</button>
              {state.canChooseSource && <button type="button" onClick={() => actions.setMenu(state.sourceMenu)} className="min-h-11 rounded-xl bg-white/10 px-5 text-sm font-bold text-white">{t('player.chooseSource')}</button>}
              <button type="button" onClick={actions.back} className="min-h-11 rounded-xl bg-white/10 px-5 text-sm font-bold text-white">{t('common.back')}</button>
            </div>
          </div>
        </div>
      )}

      {state.ended && !state.fatalError && (
        <div className="pointer-events-none absolute inset-0 z-30 grid bg-black/40 px-5">
          <div className="pointer-events-auto m-auto flex flex-col items-center gap-3 text-center" data-player-control>
            {state.nextUnavailableOffline && <p className="text-sm font-bold text-white/75">{t('player.nextUnavailableOffline')}</p>}
            {state.autoNextSeconds !== undefined && state.hasNext && (
              <p className="text-sm font-bold text-white">{t('player.nextIn', { seconds: state.autoNextSeconds })}</p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={actions.replay} className="min-h-11 rounded-xl bg-white px-5 text-sm font-extrabold text-black">{t('player.replay')}</button>
              {state.hasNext && !state.nextUnavailableOffline && <button type="button" onClick={actions.nextEpisode} className="min-h-11 rounded-xl bg-accent px-5 text-sm font-extrabold text-white">{t('player.playNext')}</button>}
              {state.autoNextSeconds !== undefined && <button type="button" onClick={actions.cancelAutoNext} className="min-h-11 rounded-xl bg-white/10 px-5 text-sm font-extrabold text-white">{t('player.cancelAutoNext')}</button>}
            </div>
          </div>
        </div>
      )}

      {state.menu === 'quality' && <OptionsPanel title={t('player.quality')} options={state.qualityOptions} selected={state.selectedQuality} onSelect={actions.selectQuality} onClose={() => actions.setMenu()} />}
      {state.menu === 'speed' && (
        <OptionsPanel
          title={t('player.speed')}
          options={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => ({ value: String(rate), label: `${rate}x` }))}
          selected={String(state.playbackRate)}
          onSelect={(value) => actions.setPlaybackRate(Number(value))}
          onClose={() => actions.setMenu()}
        />
      )}
      {state.menu === 'captions' && <OptionsPanel title={t('player.captions')} options={state.subtitleOptions} selected={state.selectedSubtitle} onSelect={actions.selectSubtitle} onClose={() => actions.setMenu()} />}
      {state.menu === 'audio' && <OptionsPanel title={t('player.audio')} options={state.audioOptions} selected={state.selectedAudio} onSelect={actions.selectAudio} onClose={() => actions.setMenu()} />}
      {state.menu === 'episodes' && <EpisodePanel state={state} actions={actions} />}
      {state.menu === 'settings' && <SettingsPanel state={state} actions={actions} />}
    </>
  )
}
