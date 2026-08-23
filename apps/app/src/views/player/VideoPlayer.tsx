import { useEffect, useRef, useState } from 'react'
import Hls, { type Level, type MediaPlaylist } from 'hls.js'
import type { Episode, Media, StreamSource } from '@woyomi/core'
import { imageSrc, playableStreamUrl, type AppRuntime } from '../../runtime'
import { useT } from '../../i18n'
import {
  PlayerControls,
  type PlayerControlsActions,
  type PlayerControlsState,
  type PlayerMenu,
  type PlayerOption
} from './PlayerControls'
import {
  clearPlaybackPosition,
  getPlaybackPosition,
  savePlaybackPosition,
  usePlayerPrefs,
  type PlayerFit
} from './player-prefs'
import {
  calculateSwipeUnlock,
  clampSeekTarget,
  findFallbackStreamIndex,
  formatTime,
  getBufferedEnd,
  getStreamIdentity,
  getStreamLabels,
  getVodDuration,
  isLiveStream,
  isResumeEligible
} from './player-state'
import {
  canUsePictureInPicture,
  enterAndroidPlayerMode,
  enterPictureInPicture,
  enterPlayerFullscreen,
  exitPictureInPicture,
  exitPlayerFullscreen,
  hasAndroidPlayerBridge,
  isInPictureInPicture,
  isPlayerFullscreen,
  requestScreenWakeLock,
  setAndroidPlayerPlaying
} from './player-platform'

interface VideoPlayerProps {
  runtime: AppRuntime
  media: Media
  episode: Episode
  episodes: Episode[]
  streams: StreamSource[]
  localUrl?: string
  downloadedEpisodeIds: Set<string>
  previousEpisode?: Episode
  nextEpisode?: Episode
  onOpenEpisode(episode: Episode): void
  onReloadStreams(): Promise<void>
  onBack(): void
}

interface TrackChoice {
  id: number
  label: string
  lang?: string
}

interface HlsLevelChoice {
  index: number
  label: string
}

interface PendingPlayback {
  time: number
  play: boolean
}

interface GestureStart {
  pointerId: number
  startX: number
  startY: number
  width: number
  startTime: number
  dragging: boolean
}

interface UnlockStart {
  pointerId: number
  startX: number
  startY: number
}

interface KeyboardActions {
  locked: boolean
  menu?: PlayerMenu
  inFullscreen: boolean
  duration: number
  back(): void
  togglePlayback(): void
  seekBy(seconds: number): void
  changeVolume(delta: number): void
  toggleMuted(): void
  toggleFullscreen(): void
  togglePictureInPicture(): void
  toggleCaptions(): void
  seekTo(seconds: number): void
  closeMenu(): void
}

const AUTO_HIDE_MS = 3000
const AUTO_NEXT_SECONDS = 8
const HLS_RETRY_LIMIT = 2

export function VideoPlayer({
  runtime,
  media,
  episode,
  episodes,
  streams,
  localUrl,
  downloadedEpisodeIds,
  previousEpisode,
  nextEpisode,
  onOpenEpisode,
  onReloadStreams,
  onBack
}: VideoPlayerProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls>()
  const hlsLiveRef = useRef<boolean>()
  const streamKindRef = useRef<StreamSource['kind']>('mp4')
  const wakeLockRef = useRef<{ release(): Promise<void> }>()
  const hideTimerRef = useRef<number>()
  const feedbackTimerRef = useRef<number>()
  const resumeTimerRef = useRef<number>()
  const lockHintTimerRef = useRef<number>()
  const tapTimerRef = useRef<number>()
  const lastTapRef = useRef<{ time: number; zone: 'left' | 'center' | 'right' }>()
  const gestureRef = useRef<GestureStart>()
  const gestureTargetRef = useRef<number>()
  const unlockRef = useRef<UnlockStart>()
  const pendingPlaybackRef = useRef<PendingPlayback>()
  const initialPositionRef = useRef<number>()
  const initialRestoreDoneRef = useRef(false)
  const playIntentRef = useRef(true)
  const mediaFailureRef = useRef<(message: string) => void>(() => undefined)
  const attemptedStreamsRef = useRef(new Set<string>())
  const lastPositionSaveRef = useRef(0)
  const selectionInitializedRef = useRef(false)
  const preferredLevelAppliedRef = useRef(false)
  const subtitlePreferenceAppliedRef = useRef(false)
  const autoNextFiredRef = useRef(false)
  const lastSubtitleRef = useRef<string>()
  const mediaActionsRef = useRef<{
    seekBy(seconds: number): void
    previous(): void
    next(): void
  }>()
  const keyboardActionsRef = useRef<KeyboardActions>()

  const { prefs, loaded: prefsLoaded, set: setPref } = usePlayerPrefs(runtime.engine.prefs)
  const preferredQualityRef = useRef(prefs.preferredQuality)
  preferredQualityRef.current = prefs.preferredQuality
  const subtitleLanguageRef = useRef(prefs.subtitleLanguage)
  subtitleLanguageRef.current = prefs.subtitleLanguage
  const [positionLoaded, setPositionLoaded] = useState(false)
  const [selectedStreamIndex, setSelectedStreamIndex] = useState(0)
  const [sourceRevision, setSourceRevision] = useState(0)
  const [paused, setPaused] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [ended, setEnded] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [seekStart, setSeekStart] = useState(0)
  const [seekEnd, setSeekEnd] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [isLive, setIsLive] = useState(false)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [controlsFocused, setControlsFocused] = useState(false)
  const [menu, setMenu] = useState<PlayerMenu>()
  const [locked, setLocked] = useState(false)
  const [lockHintVisible, setLockHintVisible] = useState(false)
  const [unlockDistance, setUnlockDistance] = useState(0)
  const [gestureSeekTime, setGestureSeekTime] = useState<number>()
  const [seekFeedback, setSeekFeedback] = useState<string>()
  const [resumeTime, setResumeTime] = useState<string>()
  const [fatalError, setFatalError] = useState<string>()
  const [autoNextSeconds, setAutoNextSeconds] = useState<number>()
  const [autoNextCancelled, setAutoNextCancelled] = useState(false)
  const [hlsLevels, setHlsLevels] = useState<HlsLevelChoice[]>([])
  const [selectedLevel, setSelectedLevel] = useState(-1)
  const [subtitleTracks, setSubtitleTracks] = useState<TrackChoice[]>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState('off')
  const [audioTracks, setAudioTracks] = useState<TrackChoice[]>([])
  const [selectedAudio, setSelectedAudio] = useState('')
  const [inFullscreen, setInFullscreen] = useState(false)
  const [inPictureInPicture, setInPictureInPicture] = useState(false)

  const selectedStream = streams[selectedStreamIndex]
  const streamLabels = getStreamLabels(streams)
  const displayTime = gestureSeekTime ?? currentTime
  const offline = localUrl !== undefined
  const previousEpisodePlayable = !!previousEpisode && (!offline || downloadedEpisodeIds.has(previousEpisode.id))
  const nextEpisodePlayable = !!nextEpisode && (!offline || downloadedEpisodeIds.has(nextEpisode.id))
  mediaActionsRef.current = { seekBy, previous: goToPrevious, next: goToNext }
  keyboardActionsRef.current = {
    locked,
    menu,
    inFullscreen,
    duration,
    back: onBack,
    togglePlayback,
    seekBy,
    changeVolume,
    toggleMuted,
    toggleFullscreen: () => void toggleFullscreen(),
    togglePictureInPicture: () => void togglePictureInPicture(),
    toggleCaptions,
    seekTo,
    closeMenu: () => setMenu(undefined)
  }

  useEffect(() => {
    let cancelled = false
    getPlaybackPosition(runtime.engine.prefs, episode.id).then((position) => {
      if (cancelled) return
      initialPositionRef.current = position
      setPositionLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [runtime.engine.prefs, episode.id])

  useEffect(() => {
    if (!prefsLoaded || selectionInitializedRef.current) return
    selectionInitializedRef.current = true
    const preferredIndex = getStreamLabels(streams).findIndex((label) => label === prefs.preferredQuality)
    if (preferredIndex >= 0) setSelectedStreamIndex(preferredIndex)
  }, [prefsLoaded, prefs.preferredQuality, streams])

  useEffect(() => {
    if (prefsLoaded) enterAndroidPlayerMode(prefs.autoRotate)
  }, [prefsLoaded, prefs.autoRotate])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !prefsLoaded) return
    video.playbackRate = prefs.playbackRate
    video.volume = prefs.volume
    video.muted = prefs.muted
    setPlaybackRateState(video.playbackRate)
    setVolumeState(video.volume)
    setMuted(video.muted)
  }, [prefsLoaded, prefs.playbackRate, prefs.volume, prefs.muted])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const syncTimeline = () => {
      const ranges = toTimeRanges(video.seekable)
      const live = isLiveStream(streamKindRef.current, video.duration, hlsLiveRef.current)
      const timelineDuration = live ? 0 : getVodDuration(video.duration, ranges)
      setSeekStart(ranges[0]?.[0] ?? 0)
      setSeekEnd(ranges[ranges.length - 1]?.[1] ?? 0)
      setDuration(timelineDuration)
      setIsLive(live)
      return timelineDuration
    }
    const syncBuffered = () => setBufferedEnd(getBufferedEnd(toTimeRanges(video.buffered), video.currentTime))
    const syncNativeSubtitleTracks = () => {
      if (hlsRef.current || video.textTracks.length === 0) return
      const tracks = Array.from(video.textTracks).map((track, index) => ({
        id: index,
        label: track.label || track.language || String(index + 1),
        lang: track.language || undefined
      }))
      setSubtitleTracks(tracks)
      if (!subtitlePreferenceAppliedRef.current) {
        subtitlePreferenceAppliedRef.current = true
        const preferred = tracks.find((track) => track.lang === subtitleLanguageRef.current)
        if (preferred) {
          for (const [index, track] of Array.from(video.textTracks).entries()) track.mode = index === preferred.id ? 'showing' : 'disabled'
          const selected = String(preferred.id)
          lastSubtitleRef.current = selected
          setSelectedSubtitle(selected)
          return
        }
      }
      const showingIndex = Array.from(video.textTracks).findIndex((track) => track.mode === 'showing')
      if (showingIndex >= 0) {
        const selected = String(showingIndex)
        lastSubtitleRef.current = selected
        setSelectedSubtitle(selected)
      } else {
        setSelectedSubtitle('off')
      }
    }
    const savePosition = () => {
      if (!video.ended && video.currentTime > 0) savePlaybackPosition(runtime.engine.prefs, episode.id, video.currentTime)
    }
    const attemptPlay = () => {
      if (!playIntentRef.current) return
      void video.play().catch(() => {
        playIntentRef.current = false
        setPaused(true)
        setBuffering(false)
      })
    }
    const finishPlayback = () => {
      playIntentRef.current = false
      setEnded(true)
      setPaused(true)
      setBuffering(false)
      setControlsVisible(true)
      setAutoNextCancelled(false)
      autoNextFiredRef.current = false
      clearPlaybackPosition(runtime.engine.prefs, episode.id)
    }
    const restorePlayback = () => {
      const timelineDuration = syncTimeline()
      syncNativeSubtitleTracks()
      const pending = pendingPlaybackRef.current
      let target = pending?.time
      if (pending) {
        playIntentRef.current = pending.play
        pendingPlaybackRef.current = undefined
      } else if (!initialRestoreDoneRef.current) {
        initialRestoreDoneRef.current = true
        const saved = initialPositionRef.current
        if (saved !== undefined && isResumeEligible(saved, timelineDuration)) {
          target = saved
          setResumeTime(formatTime(saved))
          window.clearTimeout(resumeTimerRef.current)
          resumeTimerRef.current = window.setTimeout(() => setResumeTime(undefined), 7000)
        }
      }
      if (target !== undefined && Number.isFinite(target)) {
        video.currentTime = clampToMedia(video, target)
        setCurrentTime(video.currentTime)
      }
      if (video.ended) {
        finishPlayback()
        return
      }
      attemptPlay()
    }
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      syncTimeline()
      syncBuffered()
      const now = Date.now()
      if (!video.ended && video.currentTime > 0 && now - lastPositionSaveRef.current >= 5000) {
        lastPositionSaveRef.current = now
        savePlaybackPosition(runtime.engine.prefs, episode.id, video.currentTime)
      }
      updateMediaSessionPosition(video)
    }
    const onPlay = () => {
      playIntentRef.current = true
      setPaused(false)
      setEnded(false)
      setFatalError(undefined)
    }
    const onPause = () => {
      setPaused(true)
      setBuffering(false)
      savePosition()
    }
    const onPlaying = () => {
      setBuffering(false)
      syncTimeline()
    }
    const onProgress = () => {
      syncTimeline()
      syncBuffered()
    }
    const onWaiting = () => {
      if (!video.paused) setBuffering(true)
    }
    const onEnded = () => finishPlayback()
    const onError = () => {
      if (hlsRef.current || !video.currentSrc) return
      console.warn('video element playback error:', mediaErrorCategory(video.error), video.error)
      mediaFailureRef.current(t('player.playbackFailed'))
    }
    const onVolumeChange = () => {
      setVolumeState(video.volume)
      setMuted(video.muted)
    }
    const onRateChange = () => setPlaybackRateState(video.playbackRate)
    const onEnterPictureInPicture = () => setInPictureInPicture(true)
    const onLeavePictureInPicture = () => setInPictureInPicture(false)

    video.addEventListener('loadedmetadata', restorePlayback)
    video.addEventListener('durationchange', syncTimeline)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('progress', onProgress)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('canplay', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('stalled', onWaiting)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('enterpictureinpicture', onEnterPictureInPicture)
    video.addEventListener('leavepictureinpicture', onLeavePictureInPicture)
    video.textTracks.addEventListener('addtrack', syncNativeSubtitleTracks)
    video.textTracks.addEventListener('removetrack', syncNativeSubtitleTracks)
    video.textTracks.addEventListener('change', syncNativeSubtitleTracks)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') savePosition()
    }
    const onPageHide = () => savePosition()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      savePosition()
      video.removeEventListener('loadedmetadata', restorePlayback)
      video.removeEventListener('durationchange', syncTimeline)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('canplay', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onWaiting)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('enterpictureinpicture', onEnterPictureInPicture)
      video.removeEventListener('leavepictureinpicture', onLeavePictureInPicture)
      video.textTracks.removeEventListener('addtrack', syncNativeSubtitleTracks)
      video.textTracks.removeEventListener('removetrack', syncNativeSubtitleTracks)
      video.textTracks.removeEventListener('change', syncNativeSubtitleTracks)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [runtime.engine.prefs, episode.id, positionLoaded, t])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !prefsLoaded || !positionLoaded || !selectionInitializedRef.current) return

    const source = localUrl ? { url: localUrl, kind: 'mp4' as const } : selectedStream
    if (!source) {
      setBuffering(false)
      setFatalError(t('player.noStreams'))
      return
    }

    let cancelled = false
    let hls: Hls | undefined
    let networkRetries = 0
    let mediaRetries = 0

    setBuffering(true)
    streamKindRef.current = source.kind
    setFatalError(undefined)
    setEnded(false)
    setDuration(0)
    setSeekStart(0)
    setSeekEnd(0)
    setIsLive(false)
    setHlsLevels([])
    setSelectedLevel(-1)
    setSubtitleTracks([])
    setSelectedSubtitle('off')
    setAudioTracks([])
    setSelectedAudio('')
    preferredLevelAppliedRef.current = false
    subtitlePreferenceAppliedRef.current = false
    hlsLiveRef.current = undefined

    const fail = (message: string) => {
      if (cancelled) return
      if (selectedStream) attemptedStreamsRef.current.add(getStreamIdentity(selectedStream))
      const fallbackIndex = localUrl ? -1 : findFallbackStreamIndex(streams, attemptedStreamsRef.current)
      if (fallbackIndex >= 0) {
        pendingPlaybackRef.current = { time: video.currentTime, play: playIntentRef.current }
        setSeekFeedback(t('player.tryingAnotherStream'))
        window.clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = window.setTimeout(() => setSeekFeedback(undefined), 2200)
        setSelectedStreamIndex(fallbackIndex)
        return
      }
      setBuffering(false)
      setLocked(false)
      setControlsFocused(false)
      setGestureSeekTime(undefined)
      setControlsVisible(true)
      setFatalError(message)
    }
    mediaFailureRef.current = fail

    void playableStreamUrl(source).then((url) => {
      if (cancelled) return
      if (source.kind === 'hls' && Hls.isSupported()) {
        hls = new Hls({ capLevelToPlayerSize: true })
        hlsRef.current = hls
        const updateSubtitleTracks = (tracks: MediaPlaylist[]) => {
          const choices = tracks.map((track) => ({ id: track.id, label: track.name || track.lang || String(track.id + 1), lang: track.lang }))
          setSubtitleTracks(choices)
          if (!subtitlePreferenceAppliedRef.current) {
            subtitlePreferenceAppliedRef.current = true
            const preferred = choices.find((track) => track.lang === subtitleLanguageRef.current)
            if (preferred && hls) {
              hls.subtitleDisplay = true
              hls.subtitleTrack = preferred.id
              const selected = String(preferred.id)
              lastSubtitleRef.current = selected
              setSelectedSubtitle(selected)
              return
            }
          }
          if (hls && hls.subtitleTrack >= 0) {
            const selected = String(hls.subtitleTrack)
            lastSubtitleRef.current = selected
            setSelectedSubtitle(selected)
          } else {
            setSelectedSubtitle('off')
          }
        }
        const updateAudioTracks = (tracks: MediaPlaylist[]) => {
          setAudioTracks(tracks.map((track) => ({ id: track.id, label: track.name || track.lang || String(track.id + 1), lang: track.lang })))
          if (hls && hls.audioTrack >= 0) setSelectedAudio(String(hls.audioTrack))
        }
        const updateLevels = (levels: Level[]) => {
          setHlsLevels(levels.map((level, index) => ({ index, label: hlsLevelLabel(level.height, level.name, level.bitrate) })))
        }
        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          if (cancelled) return
          const levels = data.levels.map((level, index) => ({ index, label: hlsLevelLabel(level.height, level.name, level.bitrate) }))
          setHlsLevels(levels)
          updateSubtitleTracks(data.subtitleTracks)
          updateAudioTracks(data.audioTracks)

          const preferredQuality = preferredQualityRef.current
          if (!preferredLevelAppliedRef.current && preferredQuality) {
            preferredLevelAppliedRef.current = true
            const preferred = levels.find((level) => level.label === preferredQuality)
            if (preferred) {
              hls!.currentLevel = preferred.index
              setSelectedLevel(preferred.index)
            }
          }
        })
        hls.on(Hls.Events.LEVELS_UPDATED, (_event, data) => updateLevels(data.levels))
        hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
          hlsLiveRef.current = data.details.live
          const live = isLiveStream('hls', video.duration, data.details.live)
          setDuration(live ? 0 : getVodDuration(video.duration, toTimeRanges(video.seekable)))
          setIsLive(live)
        })
        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          if (hls?.autoLevelEnabled) setSelectedLevel(-1)
          else setSelectedLevel(data.level)
        })
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
          updateSubtitleTracks(data.subtitleTracks)
        })
        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
          const selected = data.id < 0 ? 'off' : String(data.id)
          if (selected !== 'off') lastSubtitleRef.current = selected
          setSelectedSubtitle(selected)
        })
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          updateAudioTracks(data.audioTracks)
        })
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => setSelectedAudio(String(data.id)))
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || cancelled) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < HLS_RETRY_LIMIT) {
            networkRetries += 1
            hls?.startLoad(video.currentTime)
            return
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < HLS_RETRY_LIMIT) {
            mediaRetries += 1
            hls?.recoverMediaError()
            return
          }
          console.warn('fatal HLS playback error:', data)
          fail(t('player.playbackFailed'))
        })
        hls.loadSource(url)
        hls.attachMedia(video)
        return
      }

      const canPlayNativeHls = !!video.canPlayType('application/vnd.apple.mpegurl') || !!video.canPlayType('application/x-mpegURL')
      if (source.kind === 'hls' && !canPlayNativeHls) {
        fail(t('player.hlsUnsupported'))
        return
      }
      video.src = url
      video.load()
    }).catch((loadError: unknown) => fail(loadError instanceof Error ? loadError.message : String(loadError)))

    return () => {
      cancelled = true
      if (hlsRef.current === hls) hlsRef.current = undefined
      hls?.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [localUrl, selectedStream, selectedStreamIndex, sourceRevision, prefsLoaded, positionLoaded, streams, t])

  useEffect(() => {
    window.clearTimeout(hideTimerRef.current)
    if (locked) {
      setControlsVisible(false)
      return
    }
    if (paused || buffering || ended || menu || fatalError || controlsFocused || gestureSeekTime !== undefined) {
      setControlsVisible(true)
      return
    }
    if (controlsVisible) hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS)
    return () => window.clearTimeout(hideTimerRef.current)
  }, [controlsVisible, paused, buffering, ended, menu, fatalError, locked, controlsFocused, gestureSeekTime])

  useEffect(() => {
    const active = !paused && !ended && !fatalError
    setAndroidPlayerPlaying(active)
    let cancelled = false

    const releaseWakeLock = async () => {
      const lock = wakeLockRef.current
      wakeLockRef.current = undefined
      try {
        await lock?.release()
      } catch {
        // A browser may release the lock before cleanup runs.
      }
    }
    const updateWakeLock = async () => {
      if (!active || document.visibilityState !== 'visible') {
        await releaseWakeLock()
        return
      }
      if (!wakeLockRef.current) {
        const lock = await requestScreenWakeLock()
        if (cancelled) {
          try {
            await lock?.release()
          } catch {
            // The lock can already be released as the document is hidden.
          }
        } else {
          wakeLockRef.current = lock
        }
      }
    }
    void updateWakeLock()
    const onVisibility = () => void updateWakeLock()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (!active) return
      void releaseWakeLock()
      setAndroidPlayerPlaying(false)
    }
  }, [paused, ended, fatalError])

  useEffect(() => {
    const root = rootRef.current
    const video = videoRef.current
    if (!root || !video) return
    const onFullscreenChange = () => setInFullscreen(isPlayerFullscreen(root))
    const onPictureInPicture = () => setInPictureInPicture(isInPictureInPicture(video))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    video.addEventListener('enterpictureinpicture', onPictureInPicture)
    video.addEventListener('leavepictureinpicture', onPictureInPicture)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      video.removeEventListener('enterpictureinpicture', onPictureInPicture)
      video.removeEventListener('leavepictureinpicture', onPictureInPicture)
      if (document.fullscreenElement === root) void exitPlayerFullscreen().catch(() => undefined)
      if (isInPictureInPicture(video)) void exitPictureInPicture().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const artwork = imageSrc(media.coverUrl, media.coverHeaders)
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: media.title,
        artist: episode.title ?? t('common.episode', { number: episode.number }),
        artwork: artwork ? [{ src: artwork }] : []
      })
    }
    setMediaSessionHandler('play', () => void videoRef.current?.play())
    setMediaSessionHandler('pause', () => videoRef.current?.pause())
    setMediaSessionHandler('seekbackward', (details) => mediaActionsRef.current?.seekBy(-(details.seekOffset ?? 10)))
    setMediaSessionHandler('seekforward', (details) => mediaActionsRef.current?.seekBy(details.seekOffset ?? 10))
    setMediaSessionHandler('previoustrack', () => mediaActionsRef.current?.previous())
    setMediaSessionHandler('nexttrack', () => mediaActionsRef.current?.next())
    return () => {
      for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) {
        setMediaSessionHandler(action, null)
      }
      navigator.mediaSession.metadata = null
    }
  }, [media, episode, t])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = ended ? 'none' : paused ? 'paused' : 'playing'
  }, [paused, ended])

  useEffect(() => {
    if (!ended || !prefs.autoNext || !nextEpisodePlayable || autoNextCancelled) {
      setAutoNextSeconds(undefined)
      return
    }
    setAutoNextSeconds(AUTO_NEXT_SECONDS)
    const timer = window.setInterval(() => {
      setAutoNextSeconds((seconds) => (seconds === undefined ? undefined : Math.max(0, seconds - 1)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [ended, prefs.autoNext, nextEpisodePlayable, autoNextCancelled])

  useEffect(() => {
    if (autoNextSeconds !== 0 || autoNextFiredRef.current || !nextEpisode) return
    autoNextFiredRef.current = true
    onOpenEpisode(nextEpisode)
  }, [autoNextSeconds, nextEpisode, onOpenEpisode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const actions = keyboardActionsRef.current
      if (!actions) return
      const key = event.key.toLowerCase()
      if (actions.locked) {
        if (key === 'escape') actions.back()
        return
      }
      if (key === 'escape') {
        if (actions.menu) {
          event.preventDefault()
          actions.closeMenu()
        } else if (actions.inFullscreen) {
          event.preventDefault()
          void exitPlayerFullscreen()
        }
        return
      }
      if (target?.closest('input, select, textarea, button, a, [contenteditable="true"]') || target?.isContentEditable) return
      if (key === ' ' || key === 'k') {
        event.preventDefault()
        actions.togglePlayback()
      } else if (key === 'j') {
        event.preventDefault()
        actions.seekBy(-10)
      } else if (key === 'l') {
        event.preventDefault()
        actions.seekBy(10)
      } else if (key === 'arrowleft') {
        event.preventDefault()
        actions.seekBy(-5)
      } else if (key === 'arrowright') {
        event.preventDefault()
        actions.seekBy(5)
      } else if (key === 'arrowup') {
        event.preventDefault()
        actions.changeVolume(0.05)
      } else if (key === 'arrowdown') {
        event.preventDefault()
        actions.changeVolume(-0.05)
      } else if (key === 'm') {
        event.preventDefault()
        actions.toggleMuted()
      } else if (key === 'f') {
        event.preventDefault()
        actions.toggleFullscreen()
      } else if (key === 'p') {
        event.preventDefault()
        actions.togglePictureInPicture()
      } else if (key === 'c') {
        event.preventDefault()
        actions.toggleCaptions()
      } else if (/^[0-9]$/.test(key) && actions.duration > 0) {
        event.preventDefault()
        actions.seekTo((Number(key) / 10) * actions.duration)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    return () => {
      window.clearTimeout(hideTimerRef.current)
      window.clearTimeout(feedbackTimerRef.current)
      window.clearTimeout(resumeTimerRef.current)
      window.clearTimeout(lockHintTimerRef.current)
      window.clearTimeout(tapTimerRef.current)
      setAndroidPlayerPlaying(false)
      void wakeLockRef.current?.release().catch(() => undefined)
    }
  }, [])

  function revealControls(): void {
    if (locked) return
    window.clearTimeout(hideTimerRef.current)
    setControlsVisible(true)
    if (!paused && !buffering && !ended && !menu && !fatalError) {
      hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS)
    }
  }

  function togglePlayback(): void {
    const video = videoRef.current
    if (!video) return
    revealControls()
    if (video.paused || video.ended) {
      playIntentRef.current = true
      void video.play().catch(() => setPaused(true))
    } else {
      playIntentRef.current = false
      video.pause()
    }
  }

  function replay(): void {
    const video = videoRef.current
    if (!video) return
    video.currentTime = getMediaStart(video)
    setCurrentTime(video.currentTime)
    setEnded(false)
    setAutoNextCancelled(true)
    playIntentRef.current = true
    void video.play().catch(() => setPaused(true))
  }

  function seekTo(target: number): void {
    const video = videoRef.current
    if (!video || video.seekable.length === 0) return
    const clamped = clampToMedia(video, target)
    video.currentTime = clamped
    setCurrentTime(clamped)
    setGestureSeekTime(undefined)
  }

  function previewSeek(target: number): void {
    if (!videoRef.current || videoRef.current.seekable.length === 0) return
    setGestureSeekTime(clampToMedia(videoRef.current, target))
    revealControls()
  }

  function cancelSeekPreview(): void {
    setGestureSeekTime(undefined)
  }

  function jumpToLive(): void {
    const target = hlsRef.current?.liveSyncPosition ?? seekEnd
    if (target > seekStart) seekTo(target)
  }

  function seekBy(seconds: number): void {
    const video = videoRef.current
    if (!video || video.seekable.length === 0) return
    seekTo(video.currentTime + seconds)
    showSeekFeedback(seconds < 0 ? t('player.seekBackFeedback', { seconds: Math.abs(seconds) }) : t('player.seekForwardFeedback', { seconds }))
  }

  function showSeekFeedback(message: string): void {
    setSeekFeedback(message)
    window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setSeekFeedback(undefined), 900)
  }

  function setVolume(nextVolume: number): void {
    const video = videoRef.current
    if (!video) return
    const clamped = Math.min(1, Math.max(0, nextVolume))
    video.volume = clamped
    video.muted = false
    setPref('volume', clamped)
    setPref('muted', false)
  }

  function changeVolume(delta: number): void {
    setVolume((videoRef.current?.volume ?? volume) + delta)
  }

  function toggleMuted(): void {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setPref('muted', video.muted)
  }

  function setPlaybackRate(rate: number): void {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = rate
    setPref('playbackRate', rate)
    setMenu(undefined)
  }

  function setFit(fit: PlayerFit): void {
    setPref('fit', fit)
  }

  function setAutoNext(enabled: boolean): void {
    setPref('autoNext', enabled)
    setAutoNextCancelled(!enabled)
  }

  function setAutoRotate(enabled: boolean): void {
    setPref('autoRotate', enabled)
  }

  function selectQuality(value: string): void {
    const video = videoRef.current
    if (value.startsWith('stream:')) {
      const index = Number(value.slice('stream:'.length))
      const stream = streams[index]
      if (!stream || index === selectedStreamIndex) {
        setMenu(undefined)
        return
      }
      pendingPlaybackRef.current = { time: video?.currentTime ?? currentTime, play: !!video && !video.paused }
      attemptedStreamsRef.current.clear()
      setSelectedStreamIndex(index)
      setPref('preferredQuality', getStreamLabels(streams)[index] ?? '')
    } else if (value.startsWith('level:')) {
      const level = Number(value.slice('level:'.length))
      if (hlsRef.current) hlsRef.current.currentLevel = level
      setSelectedLevel(level)
      const label = level < 0 ? '' : hlsLevels.find((item) => item.index === level)?.label ?? ''
      setPref('preferredQuality', label)
    }
    setMenu(undefined)
  }

  function selectSubtitle(value: string): void {
    const video = videoRef.current
    if (value === 'off') {
      if (hlsRef.current) {
        hlsRef.current.subtitleTrack = -1
        hlsRef.current.subtitleDisplay = false
      }
      for (const track of Array.from(video?.textTracks ?? [])) track.mode = 'disabled'
      setSelectedSubtitle('off')
      setMenu(undefined)
      return
    }
    const id = Number(value)
    if (hlsRef.current) {
      hlsRef.current.subtitleDisplay = true
      hlsRef.current.subtitleTrack = id
    } else {
      for (const [index, track] of Array.from(video?.textTracks ?? []).entries()) track.mode = index === id ? 'showing' : 'disabled'
    }
    const selected = subtitleTracks.find((track) => track.id === id)
    if (selected?.lang) setPref('subtitleLanguage', selected.lang)
    lastSubtitleRef.current = value
    setSelectedSubtitle(value)
    setMenu(undefined)
  }

  function toggleCaptions(): void {
    if (subtitleTracks.length === 0) return
    if (selectedSubtitle === 'off') {
      const preferred = subtitleTracks.find((track) => track.lang === subtitleLanguageRef.current)
      const lastSelected = lastSubtitleRef.current
      const next = lastSelected && subtitleTracks.some((track) => String(track.id) === lastSelected)
        ? lastSelected
        : String(preferred?.id ?? subtitleTracks[0]!.id)
      selectSubtitle(next)
    }
    else selectSubtitle('off')
  }

  function selectAudio(value: string): void {
    const id = Number(value)
    if (hlsRef.current) hlsRef.current.audioTrack = id
    setSelectedAudio(value)
    setMenu(undefined)
  }

  function goToPrevious(): void {
    if (!previousEpisode) return
    if (!previousEpisodePlayable) {
      showSeekFeedback(t('player.episodeUnavailableOffline'))
      return
    }
    onOpenEpisode(previousEpisode)
  }

  function goToNext(): void {
    if (!nextEpisode) return
    if (!nextEpisodePlayable) {
      showSeekFeedback(t('player.nextUnavailableOffline'))
      return
    }
    onOpenEpisode(nextEpisode)
  }

  async function toggleFullscreen(): Promise<void> {
    const root = rootRef.current
    if (!root || hasAndroidPlayerBridge()) return
    try {
      if (isPlayerFullscreen(root)) await exitPlayerFullscreen()
      else await enterPlayerFullscreen(root)
    } catch (fullscreenError) {
      console.warn('player fullscreen failed:', fullscreenError)
    }
  }

  async function togglePictureInPicture(): Promise<void> {
    const video = videoRef.current
    if (!video || !canUsePictureInPicture(video)) return
    try {
      if (isInPictureInPicture(video)) await exitPictureInPicture()
      else await enterPictureInPicture(video)
    } catch (pipError) {
      console.warn('picture-in-picture failed:', pipError)
    }
  }

  function retry(): void {
    if (!localUrl && streams.length === 0) {
      setBuffering(true)
      setFatalError(undefined)
      void onReloadStreams().catch((streamError: unknown) => {
        console.warn('failed to reload video streams:', streamError)
        setBuffering(false)
        setFatalError(t('player.streamLoadFailed'))
      })
      return
    }
    const video = videoRef.current
    pendingPlaybackRef.current = { time: video?.currentTime ?? currentTime, play: playIntentRef.current }
    attemptedStreamsRef.current.clear()
    setFatalError(undefined)
    setSourceRevision((revision) => revision + 1)
  }

  function startOver(): void {
    clearPlaybackPosition(runtime.engine.prefs, episode.id)
    setResumeTime(undefined)
    seekTo(getMediaStart(videoRef.current))
  }

  function lockPlayer(): void {
    gestureRef.current = undefined
    gestureTargetRef.current = undefined
    lastTapRef.current = undefined
    window.clearTimeout(tapTimerRef.current)
    setGestureSeekTime(undefined)
    setSeekFeedback(undefined)
    setControlsFocused(false)
    setMenu(undefined)
    setControlsVisible(false)
    setLocked(true)
    setLockHintVisible(true)
    setUnlockDistance(0)
    window.clearTimeout(lockHintTimerRef.current)
    lockHintTimerRef.current = window.setTimeout(() => setLockHintVisible(false), 2600)
  }

  function unlockPlayer(): void {
    unlockRef.current = undefined
    setUnlockDistance(0)
    setLocked(false)
    setLockHintVisible(false)
    setControlsVisible(true)
  }

  function showLockedHint(): void {
    setLockHintVisible(true)
    window.clearTimeout(lockHintTimerRef.current)
    lockHintTimerRef.current = window.setTimeout(() => setLockHintVisible(false), 2200)
  }

  function onUnlockPointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    unlockRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
    setUnlockDistance(0)
    setLockHintVisible(true)
  }

  function onUnlockPointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    const start = unlockRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const deltaX = event.clientX - start.startX
    const deltaY = event.clientY - start.startY
    const swipe = calculateSwipeUnlock(deltaX, deltaY)
    setUnlockDistance(swipe.failed ? 0 : swipe.progress * 72)
  }

  function finishUnlock(event: React.PointerEvent<HTMLButtonElement>, cancelled: boolean): void {
    event.stopPropagation()
    const start = unlockRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const deltaX = event.clientX - start.startX
    const deltaY = event.clientY - start.startY
    unlockRef.current = undefined
    if (!cancelled && calculateSwipeUnlock(deltaX, deltaY, true).unlocked) unlockPlayer()
    else {
      setUnlockDistance(0)
      showLockedHint()
    }
  }

  function onUnlockKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      unlockPlayer()
    }
  }

  function onStagePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('[data-player-control]')) return
    if (locked) {
      showLockedHint()
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
      width: bounds.width,
      startTime: videoRef.current?.currentTime ?? 0,
      dragging: false
    }
    gestureTargetRef.current = undefined
  }

  function onStagePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    revealControls()
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (!videoRef.current || videoRef.current.seekable.length === 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const deltaX = event.clientX - bounds.left - gesture.startX
    const deltaY = event.clientY - bounds.top - gesture.startY
    if (!gesture.dragging && Math.abs(deltaX) >= 12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) gesture.dragging = true
    if (!gesture.dragging) return
    const target = clampToMedia(videoRef.current, gesture.startTime + (deltaX / Math.max(1, gesture.width)) * 120)
    gestureTargetRef.current = target
    setGestureSeekTime(target)
  }

  function onStagePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    if (gesture.dragging && gestureTargetRef.current !== undefined) {
      const delta = gestureTargetRef.current - gesture.startTime
      seekTo(gestureTargetRef.current)
      showSeekFeedback(delta < 0 ? t('player.seekBackFeedback', { seconds: Math.round(Math.abs(delta)) }) : t('player.seekForwardFeedback', { seconds: Math.round(delta) }))
      gestureTargetRef.current = undefined
      return
    }

    const x = gesture.startX
    const zone = x < gesture.width / 3 ? 'left' : x >= (gesture.width * 2) / 3 ? 'right' : 'center'
    const now = Date.now()
    const lastTap = lastTapRef.current
    if (lastTap && lastTap.zone === zone && now - lastTap.time <= 300) {
      window.clearTimeout(tapTimerRef.current)
      lastTapRef.current = undefined
      if (zone === 'left') seekBy(-10)
      else if (zone === 'right') seekBy(10)
      else togglePlayback()
      return
    }
    lastTapRef.current = { time: now, zone }
    window.clearTimeout(tapTimerRef.current)
    tapTimerRef.current = window.setTimeout(() => {
      lastTapRef.current = undefined
      setControlsVisible((visible) => !visible)
    }, 260)
  }

  function onStagePointerCancel(event: React.PointerEvent<HTMLDivElement>): void {
    if (gestureRef.current?.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    gestureTargetRef.current = undefined
    setGestureSeekTime(undefined)
  }

  function onPlayerFocus(event: React.FocusEvent<HTMLDivElement>): void {
    if (locked || !(event.target as HTMLElement).closest('[data-player-control]')) return
    setControlsFocused(true)
    revealControls()
  }

  function onPlayerBlur(event: React.FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget as HTMLElement | null
    if (next?.closest('[data-player-control]')) return
    setControlsFocused(false)
  }

  const qualityOptions: PlayerOption[] = []
  if (!offline && hlsLevels.length > 1) {
    qualityOptions.push({ value: 'level:-1', label: t('player.qualityAuto') })
    qualityOptions.push(...hlsLevels.map((level) => ({ value: `level:${level.index}`, label: level.label })))
  }
  if (!offline && streams.length > 1) {
    qualityOptions.push(...streams.map((stream, index) => ({ value: `stream:${index}`, label: streamLabels[index] ?? stream.kind.toUpperCase() })))
  }
  const selectedQuality = hlsLevels.length > 1 ? `level:${selectedLevel}` : `stream:${selectedStreamIndex}`
  const qualityLabel = hlsLevels.length > 1
    ? selectedLevel < 0
      ? t('player.qualityAuto')
      : hlsLevels.find((level) => level.index === selectedLevel)?.label ?? t('player.qualityAuto')
    : selectedStream
      ? streamLabels[selectedStreamIndex] ?? selectedStream.kind.toUpperCase()
      : ''
  const subtitleOptions: PlayerOption[] = [
    { value: 'off', label: t('player.captionsOff') },
    ...subtitleTracks.map((track) => ({ value: String(track.id), label: track.label }))
  ]
  const audioOptions: PlayerOption[] = audioTracks.map((track) => ({ value: String(track.id), label: track.label }))
  const canSeek = seekEnd > seekStart
  const liveTarget = hlsRef.current?.liveSyncPosition ?? seekEnd
  const behindLive = isLive && canSeek && liveTarget - displayTime > 5
  const episodeLabel = `${t('common.episode', { number: episode.number })}${episode.season != null ? t('common.season', { season: episode.season }) : ''}${
    episode.title ? t('common.title', { title: episode.title }) : ''
  }`
  const video = videoRef.current
  const controlsState: PlayerControlsState = {
    visible: controlsVisible,
    locked,
    lockHintVisible,
    unlockDistance,
    title: media.title,
    episodeLabel,
    offline,
    paused,
    buffering,
    ended,
    currentTime: displayTime,
    duration,
    seekStart,
    seekEnd,
    canSeek,
    bufferedEnd,
    isLive,
    behindLive,
    volume,
    muted,
    playbackRate,
    fit: prefs.fit,
    autoNext: prefs.autoNext,
    autoRotate: prefs.autoRotate,
    menu,
    qualityLabel,
    qualityOptions,
    selectedQuality,
    subtitleOptions,
    selectedSubtitle,
    audioOptions,
    selectedAudio,
    episodes,
    currentEpisodeId: episode.id,
    downloadedEpisodeIds,
    hasPrevious: previousEpisodePlayable,
    hasNext: !!nextEpisode,
    nextUnavailableOffline: !!nextEpisode && !nextEpisodePlayable,
    canChooseQuality: qualityOptions.length > 0,
    canUsePictureInPicture: !!video && canUsePictureInPicture(video),
    inPictureInPicture,
    canUseFullscreen: !hasAndroidPlayerBridge() && !!rootRef.current?.requestFullscreen,
    inFullscreen,
    resumeTime,
    seekFeedback,
    fatalError,
    autoNextSeconds
  }
  const controlsActions: PlayerControlsActions = {
    back: onBack,
    showControls: revealControls,
    togglePlayback,
    replay,
    seekBy,
    seekTo,
    previewSeek,
    cancelSeekPreview,
    jumpToLive,
    setVolume,
    toggleMuted,
    setPlaybackRate,
    setFit,
    setAutoNext,
    setAutoRotate,
    setMenu,
    selectQuality,
    selectSubtitle,
    selectAudio,
    previousEpisode: goToPrevious,
    nextEpisode: goToNext,
    openEpisode: onOpenEpisode,
    togglePictureInPicture: () => void togglePictureInPicture(),
    toggleFullscreen: () => void toggleFullscreen(),
    lock: lockPlayer,
    retry,
    startOver,
    cancelAutoNext: () => {
      setAutoNextCancelled(true)
      setAutoNextSeconds(undefined)
    },
    onUnlockPointerDown,
    onUnlockPointerMove,
    onUnlockPointerUp: (event) => finishUnlock(event, false),
    onUnlockPointerCancel: (event) => finishUnlock(event, true),
    onUnlockKeyDown
  }

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-50 overflow-hidden bg-black text-fg ${controlsVisible || locked ? '' : 'cursor-none'}`}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerCancel}
      onFocusCapture={onPlayerFocus}
      onBlurCapture={onPlayerBlur}
      style={{ touchAction: 'none' }}
    >
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        className={`pointer-events-none size-full bg-black ${prefs.fit === 'cover' ? 'object-cover' : 'object-contain'}`}
      />
      <PlayerControls state={controlsState} actions={controlsActions} />
    </div>
  )
}

function hlsLevelLabel(height: number, name: string, bitrate: number): string {
  if (height > 0) return `${height}p`
  if (name) return name
  if (bitrate > 0) return `${(bitrate / 1_000_000).toFixed(1)} Mbps`
  return 'HLS'
}

function getMediaStart(video: HTMLVideoElement | null): number {
  if (!video || video.seekable.length === 0) return 0
  return video.seekable.start(0)
}

function clampToMedia(video: HTMLVideoElement | null, target: number): number {
  if (!video || !Number.isFinite(target)) return 0
  const mediaDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity
  return clampSeekTarget(target, mediaDuration, toTimeRanges(video.seekable))
}

function toTimeRanges(ranges: TimeRanges): Array<readonly [number, number]> {
  return Array.from({ length: ranges.length }, (_, index) => [ranges.start(index), ranges.end(index)] as const)
}

function mediaErrorCategory(error: MediaError | null): string {
  if (!error) return 'unknown'
  return error.code === MediaError.MEDIA_ERR_ABORTED
    ? 'aborted'
    : error.code === MediaError.MEDIA_ERR_NETWORK
      ? 'network'
      : error.code === MediaError.MEDIA_ERR_DECODE
        ? 'decode'
        : error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'unsupported'
          : 'unknown'
}

function setMediaSessionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
  try {
    navigator.mediaSession.setActionHandler(action, handler)
  } catch {
    // Individual actions vary by WebView implementation.
  }
}

function updateMediaSessionPosition(video: HTMLVideoElement): void {
  if (!('mediaSession' in navigator) || !Number.isFinite(video.duration) || video.duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration: video.duration,
      playbackRate: video.playbackRate,
      position: Math.min(video.duration, Math.max(0, video.currentTime))
    })
  } catch {
    // Some WebViews expose Media Session without position-state support.
  }
}
