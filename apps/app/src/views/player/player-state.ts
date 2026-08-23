import type { StreamSource } from '@woyomi/core'

export type TimeRange =
  | [start: number, end: number]
  | readonly [start: number, end: number]
  | { start: number; end: number }
  | { readonly start: number; readonly end: number }

export const SWIPE_UNLOCK_THRESHOLD = 72

export interface SwipeUnlockResult {
  /** Normalized progress from 0 to 1 */
  progress: number
  /** True when the swipe gesture reaches or exceeds the threshold with horizontal dominance */
  unlocked: boolean
  /** True when the gesture failed or was cancelled (e.g. vertical dominance, swiping backward, or early release) */
  failed: boolean
  /** Alias for failed */
  cancelled: boolean
}

/** Formats a timestamp in seconds into `M:SS` or `H:MM:SS`. */
export function formatTime(seconds: number, guideOrForceHours?: number | boolean): string {
  if (Number.isNaN(seconds) || seconds < 0) {
    const showHours =
      typeof guideOrForceHours === 'number'
        ? Number.isFinite(guideOrForceHours) && guideOrForceHours >= 3600
        : Boolean(guideOrForceHours)
    return showHours ? '0:00:00' : '0:00'
  }

  if (!Number.isFinite(seconds)) {
    return 'Live'
  }

  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  const showHours =
    typeof guideOrForceHours === 'number'
      ? (Number.isFinite(guideOrForceHours) && guideOrForceHours >= 3600) || hours > 0
      : Boolean(guideOrForceHours) || hours > 0

  const sStr = secs.toString().padStart(2, '0')
  if (showHours) {
    const mStr = minutes.toString().padStart(2, '0')
    return `${hours}:${mStr}:${sStr}`
  }
  return `${minutes}:${sStr}`
}

/** Returns true if duration represents a live/infinite stream. */
export function isLiveStream(duration: number): boolean {
  return !Number.isFinite(duration)
}

function parseRange(range: TimeRange): [number, number] | null {
  if (Array.isArray(range)) {
    const s = range[0]
    const e = range[1]
    if (typeof s === 'number' && typeof e === 'number' && Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      return [Math.max(0, s), Math.max(0, e)]
    }
  } else if (range && typeof range === 'object' && 'start' in range && 'end' in range) {
    const s = range.start
    const e = range.end
    if (typeof s === 'number' && typeof e === 'number' && Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      return [Math.max(0, s), Math.max(0, e)]
    }
  }
  return null
}

/** Cleans, sorts, and merges overlapping or contiguous time ranges into `[start, end]` tuples. */
export function normalizeTimeRanges(ranges: readonly TimeRange[]): [number, number][] {
  if (!ranges || ranges.length === 0) return []

  const valid: [number, number][] = []
  for (const r of ranges) {
    const parsed = parseRange(r)
    if (parsed) valid.push(parsed)
  }

  if (valid.length === 0) return []
  valid.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const merged: [number, number][] = [valid[0]!]
  for (let i = 1; i < valid.length; i++) {
    const current = valid[i]!
    const last = merged[merged.length - 1]!
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1])
    } else {
      merged.push([current[0], current[1]])
    }
  }

  return merged
}

/** Clamps seek target to valid time within duration and normalized seekable ranges. */
export function clampSeekTarget(target: number, duration: number, seekable?: readonly TimeRange[]): number {
  if (Number.isNaN(target)) return 0
  const safeTarget = Math.max(0, target)

  const isFiniteDuration = Number.isFinite(duration)
  if (isFiniteDuration && duration <= 0) return 0
  if (!isFiniteDuration && duration !== Infinity) return 0

  let normalized = seekable ? normalizeTimeRanges(seekable) : []

  if (isFiniteDuration && duration > 0 && normalized.length > 0) {
    const capped: [number, number][] = []
    for (const range of normalized) {
      if (range[0] >= duration) break
      capped.push([range[0], Math.min(range[1], duration)])
    }
    normalized = capped
  }

  if (normalized.length > 0) {
    const first = normalized[0]!
    const last = normalized[normalized.length - 1]!

    if (safeTarget <= first[0]) return first[0]
    if (safeTarget >= last[1]) return last[1]

    for (let i = 0; i < normalized.length; i++) {
      const range = normalized[i]!
      if (safeTarget >= range[0] && safeTarget <= range[1]) {
        return safeTarget
      }
      if (i + 1 < normalized.length) {
        const next = normalized[i + 1]!
        if (safeTarget > range[1] && safeTarget < next[0]) {
          const distToPrev = safeTarget - range[1]
          const distToNext = next[0] - safeTarget
          return distToPrev <= distToNext ? range[1] : next[0]
        }
      }
    }
  }

  if (duration === Infinity) return safeTarget
  return Math.min(safeTarget, duration)
}

/** Selects buffered end time around or ahead of currentTime. */
export function getBufferedEnd(buffered: readonly TimeRange[], currentTime = 0): number {
  const safeTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
  const normalized = normalizeTimeRanges(buffered)
  if (normalized.length === 0) return 0

  for (const range of normalized) {
    if (safeTime >= range[0] && safeTime <= range[1]) {
      return range[1]
    }
  }

  for (const range of normalized) {
    if (range[0] > safeTime) {
      return range[1]
    }
  }

  return 0
}

/** Calculates buffered fraction (0 to 1) around or ahead of currentTime. */
export function getBufferedFraction(buffered: readonly TimeRange[], duration: number, currentTime = 0): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  const end = getBufferedEnd(buffered, currentTime)
  const fraction = end / duration
  return Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
}

/** Returns true if playback position is meaningful for resuming (>= 10s and not within final 30s or final 5%). */
export function isResumeEligible(position: number, duration: number): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return false
  if (duration <= 0 || position < 10 || position >= duration) return false
  const remainingTime = duration - position
  const remainingFraction = remainingTime / duration
  return remainingTime > 30 && remainingFraction > 0.05
}

/** Formats a single stream label based on quality and kind. */
export function formatStreamLabel(stream: StreamSource): string {
  const quality = stream.quality?.trim()
  if (quality) return quality
  return stream.kind ? stream.kind.toUpperCase() : 'Video'
}

/** Returns display labels for a list of streams without reordering, disambiguating duplicates. */
export function getStreamLabels(streams: readonly StreamSource[]): string[] {
  if (streams.length === 0) return []
  const baseLabels = streams.map(formatStreamLabel)

  const baseCounts = new Map<string, number>()
  for (const label of baseLabels) {
    baseCounts.set(label, (baseCounts.get(label) ?? 0) + 1)
  }

  const step1Labels: string[] = []
  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i]!
    const base = baseLabels[i]!
    if ((baseCounts.get(base) ?? 0) > 1 && stream.quality?.trim()) {
      step1Labels.push(`${base} (${stream.kind.toUpperCase()})`)
    } else {
      step1Labels.push(base)
    }
  }

  const step1Counts = new Map<string, number>()
  for (const label of step1Labels) {
    step1Counts.set(label, (step1Counts.get(label) ?? 0) + 1)
  }

  const occurrenceTracker = new Map<string, number>()
  const finalLabels: string[] = []
  for (let i = 0; i < step1Labels.length; i++) {
    const label = step1Labels[i]!
    const total = step1Counts.get(label) ?? 0
    if (total > 1) {
      const num = (occurrenceTracker.get(label) ?? 0) + 1
      occurrenceTracker.set(label, num)
      finalLabels.push(`${label} (${num})`)
    } else {
      finalLabels.push(label)
    }
  }

  return finalLabels
}

/** Stable stream identity used to avoid retrying duplicate provider entries. */
export function getStreamIdentity(stream: StreamSource): string {
  const headers = Object.entries(stream.headers ?? {}).sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify([stream.kind, stream.url, headers])
}

/** First provider-ordered stream whose effective URL/header tuple has not failed. */
export function findFallbackStreamIndex(streams: readonly StreamSource[], attempted: ReadonlySet<string>): number {
  return streams.findIndex((stream) => !attempted.has(getStreamIdentity(stream)))
}

/** Evaluates swipe-to-unlock gesture. Horizontal swipe must dominate vertical and exceed threshold. */
export function calculateSwipeUnlock(
  deltaX: number,
  deltaY: number,
  releasedOrThreshold: boolean | number = false,
  thresholdParam = SWIPE_UNLOCK_THRESHOLD
): SwipeUnlockResult {
  const released = typeof releasedOrThreshold === 'boolean' ? releasedOrThreshold : false
  const threshold = typeof releasedOrThreshold === 'number' ? releasedOrThreshold : thresholdParam

  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || threshold <= 0) {
    return { progress: 0, unlocked: false, failed: true, cancelled: true }
  }

  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)
  const isHorizontalDominant = absX > absY && deltaX > 0

  if (!isHorizontalDominant) {
    return {
      progress: 0,
      unlocked: false,
      failed: true,
      cancelled: true
    }
  }

  const progress = Math.min(1, Math.max(0, deltaX / threshold))
  const reachesThreshold = deltaX >= threshold

  if (released) {
    return {
      progress: reachesThreshold ? 1 : progress,
      unlocked: reachesThreshold,
      failed: !reachesThreshold,
      cancelled: !reachesThreshold
    }
  }

  return {
    progress,
    unlocked: reachesThreshold,
    failed: false,
    cancelled: false
  }
}
