import { describe, expect, it } from 'vitest'
import type { StreamSource } from '@woyomi/core'
import {
  calculateSwipeUnlock,
  clampSeekTarget,
  decideStallRecovery,
  findFallbackStreamIndex,
  formatStreamLabel,
  formatTime,
  getBufferedEnd,
  getBufferedFraction,
  getStreamIdentity,
  getStreamLabels,
  getVodDuration,
  isMainHlsFragment,
  isLiveStream,
  isResumeEligible,
  normalizeTimeRanges,
  playbackFragmentContains,
  splitStreamOptions,
  SWIPE_UNLOCK_THRESHOLD
} from './player-state'

describe('formatTime', () => {
  it('formats sub-minute and minute-based timestamps', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(45)).toBe('0:45')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(599)).toBe('9:59')
    expect(formatTime(600)).toBe('10:00')
    expect(formatTime(3599)).toBe('59:59')
  })

  it('formats hour-based timestamps', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(3665)).toBe('1:01:05')
    expect(formatTime(7322)).toBe('2:02:02')
    expect(formatTime(36000)).toBe('10:00:00')
  })

  it('forces hours display when forceHours is true', () => {
    expect(formatTime(0, true)).toBe('0:00:00')
    expect(formatTime(65, true)).toBe('0:01:05')
    expect(formatTime(3599, true)).toBe('0:59:59')
  })

  it('forces hours display when guide duration is >= 3600 seconds', () => {
    expect(formatTime(65, 3600)).toBe('0:01:05')
    expect(formatTime(65, 5400)).toBe('0:01:05')
    expect(formatTime(65, 1200)).toBe('1:05')
  })

  it('handles live, infinite, negative, and NaN values', () => {
    expect(formatTime(Infinity)).toBe('Live')
    expect(formatTime(NaN)).toBe('0:00')
    expect(formatTime(-10)).toBe('0:00')
    expect(formatTime(-Infinity)).toBe('0:00')
    expect(formatTime(NaN, true)).toBe('0:00:00')
    expect(formatTime(-5, true)).toBe('0:00:00')
  })
})

describe('isLiveStream', () => {
  it('does not classify MP4 streams as live when WebKit reports an unknown duration', () => {
    expect(isLiveStream('mp4', NaN)).toBe(false)
    expect(isLiveStream('mp4', Infinity)).toBe(false)
    expect(isLiveStream('mp4', 120)).toBe(false)
  })

  it('uses playlist metadata for HLS and infinity for native HLS fallback', () => {
    expect(isLiveStream('hls', NaN)).toBe(false)
    expect(isLiveStream('hls', Infinity)).toBe(true)
    expect(isLiveStream('hls', -Infinity)).toBe(false)
    expect(isLiveStream('hls', 120)).toBe(false)
    expect(isLiveStream('hls', Infinity, false)).toBe(false)
    expect(isLiveStream('hls', 120, true)).toBe(true)
  })
})

describe('normalizeTimeRanges', () => {
  it('handles empty and nullish inputs', () => {
    expect(normalizeTimeRanges([])).toEqual([])
  })

  it('normalizes tuple and object range representations', () => {
    const tuples = normalizeTimeRanges([[0, 10], [15, 25]])
    expect(tuples).toEqual([[0, 10], [15, 25]])

    const objects = normalizeTimeRanges([{ start: 0, end: 10 }, { start: 15, end: 25 }])
    expect(objects).toEqual([[0, 10], [15, 25]])
  })

  it('sorts and merges overlapping or contiguous ranges', () => {
    const unsorted = normalizeTimeRanges([[20, 30], [0, 10]])
    expect(unsorted).toEqual([[0, 10], [20, 30]])

    const overlapping = normalizeTimeRanges([[0, 15], [10, 25], [30, 40]])
    expect(overlapping).toEqual([[0, 25], [30, 40]])

    const contiguous = normalizeTimeRanges([[0, 10], [10, 20]])
    expect(contiguous).toEqual([[0, 20]])
  })

  it('discards invalid and non-finite ranges and clamps negative starts', () => {
    const ranges = normalizeTimeRanges([
      [-5, 10],
      [20, 10], // invalid (start > end)
      [NaN, 30],
      [40, Infinity]
    ])
    expect(ranges).toEqual([[0, 10]])
  })
})

describe('repeated HLS fragment stalls', () => {
  const mushoku720Fragment = {
    key: 'stream|level:1|sn:39|40.jpg',
    start: 239.531,
    end: 246.538
  }

  it('ignores audio and subtitle activity when tracking main-video loads', () => {
    expect(isMainHlsFragment({ type: 'main' })).toBe(true)
    expect(isMainHlsFragment({ type: 'audio' })).toBe(false)
    expect(isMainHlsFragment({ type: 'subtitle' })).toBe(false)
    expect(isMainHlsFragment(undefined)).toBe(false)
  })

  it('recognizes the playhead inside a fragment with a small boundary tolerance', () => {
    expect(playbackFragmentContains(mushoku720Fragment, 243)).toBe(true)
    expect(playbackFragmentContains(mushoku720Fragment, 239.4)).toBe(true)
    expect(playbackFragmentContains(mushoku720Fragment, 239)).toBe(false)
    expect(playbackFragmentContains(mushoku720Fragment, 246.538)).toBe(false)
  })

  it('skips precisely past the Mushoku 720p fragment after a repeated stall', () => {
    const decision = decideStallRecovery({
      suspectedFragment: mushoku720Fragment,
      currentFragment: mushoku720Fragment,
      currentTime: 243,
      buffered: [[228.8, 259.1]],
      mainFragmentLoading: false,
      recoveries: 1,
      maxRecoveries: 2
    })
    expect(decision.action).toBe('skip')
    if (decision.action === 'skip') expect(decision.target).toBeCloseTo(246.588)
  })

  it('reloads an ordinary stall without repeat evidence or buffered media beyond the fragment', () => {
    expect(
      decideStallRecovery({
        currentFragment: mushoku720Fragment,
        currentTime: 243,
        buffered: [[228.8, 259.1]],
        mainFragmentLoading: false,
        recoveries: 0,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'reload' })
    expect(
      decideStallRecovery({
        suspectedFragment: mushoku720Fragment,
        currentFragment: mushoku720Fragment,
        currentTime: 243,
        buffered: [[228.8, 259.1]],
        mainFragmentLoading: false,
        recoveries: 0,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'reload' })
    expect(
      decideStallRecovery({
        suspectedFragment: mushoku720Fragment,
        currentFragment: mushoku720Fragment,
        currentTime: 243,
        buffered: [[228.8, 246.6]],
        mainFragmentLoading: false,
        recoveries: 1,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'reload' })
    // A later range far away is not evidence that the fragment boundary is a
    // safe landing point.
    expect(
      decideStallRecovery({
        suspectedFragment: mushoku720Fragment,
        currentFragment: mushoku720Fragment,
        currentTime: 243,
        buffered: [[300, 320]],
        mainFragmentLoading: false,
        recoveries: 1,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'reload' })
    expect(
      decideStallRecovery({
        suspectedFragment: mushoku720Fragment,
        currentFragment: mushoku720Fragment,
        currentTime: 243,
        buffered: [[228.8, 259.1]],
        mainFragmentLoading: true,
        recoveries: 1,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'reload' })
  })

  it('does not skip when the rendition changed or the playhead left the fragment', () => {
    expect(
      decideStallRecovery({
        suspectedFragment: mushoku720Fragment,
        currentFragment: { ...mushoku720Fragment, key: 'stream|level:0|sn:39|40.jpg' },
        currentTime: 243,
        buffered: [[228.8, 259.1]],
        mainFragmentLoading: false,
        recoveries: 1,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'reload' })
    expect(
      decideStallRecovery({
        suspectedFragment: mushoku720Fragment,
        currentFragment: mushoku720Fragment,
        currentTime: 250,
        buffered: [[228.8, 259.1]],
        mainFragmentLoading: false,
        recoveries: 1,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'reload' })
  })

  it('fails only after the reload budget is exhausted', () => {
    expect(
      decideStallRecovery({
        currentTime: 243,
        buffered: [],
        mainFragmentLoading: false,
        recoveries: 2,
        maxRecoveries: 2
      })
    ).toEqual({ action: 'fail' })
  })

  it('still skips a confirmed repeat when the regular reload budget is exhausted', () => {
    const decision = decideStallRecovery({
      suspectedFragment: mushoku720Fragment,
      currentFragment: mushoku720Fragment,
      currentTime: 243,
      buffered: [[228.8, 259.1]],
      mainFragmentLoading: false,
      recoveries: 2,
      maxRecoveries: 2
    })
    expect(decision.action).toBe('skip')
  })
})

describe('getVodDuration', () => {
  it('prefers a finite media duration', () => {
    expect(getVodDuration(120, [[0, 100]])).toBe(120)
  })

  it('falls back to the seekable endpoint for WebKit unknown durations', () => {
    expect(getVodDuration(NaN, [[0, 120]])).toBe(120)
    expect(getVodDuration(Infinity, [[0, 120]])).toBe(120)
    expect(getVodDuration(Infinity, [[0, 40], [60, 120]])).toBe(120)
  })

  it('returns zero until duration metadata is available', () => {
    expect(getVodDuration(NaN, [])).toBe(0)
    expect(getVodDuration(0, [])).toBe(0)
  })
})

describe('clampSeekTarget', () => {
  it('clamps within finite duration when seekable is absent', () => {
    expect(clampSeekTarget(50, 100)).toBe(50)
    expect(clampSeekTarget(-10, 100)).toBe(0)
    expect(clampSeekTarget(150, 100)).toBe(100)
  })

  it('handles non-finite, zero, and live duration', () => {
    expect(clampSeekTarget(50, 0)).toBe(0)
    expect(clampSeekTarget(50, -10)).toBe(0)
    expect(clampSeekTarget(50, NaN)).toBe(0)
    expect(clampSeekTarget(50, Infinity)).toBe(50)
    expect(clampSeekTarget(-10, Infinity)).toBe(0)
    expect(clampSeekTarget(NaN, 100)).toBe(0)
  })

  it('clamps against a single seekable range', () => {
    const seekable = [{ start: 10, end: 50 }]
    expect(clampSeekTarget(5, 100, seekable)).toBe(10)
    expect(clampSeekTarget(30, 100, seekable)).toBe(30)
    expect(clampSeekTarget(60, 100, seekable)).toBe(50)
  })

  it('clamps against disjoint seekable ranges and snaps in gaps', () => {
    const seekable = [[10, 30], [40, 60]] as const
    expect(clampSeekTarget(5, 100, seekable)).toBe(10)
    expect(clampSeekTarget(20, 100, seekable)).toBe(20)
    expect(clampSeekTarget(32, 100, seekable)).toBe(30)
    expect(clampSeekTarget(38, 100, seekable)).toBe(40)
    expect(clampSeekTarget(35, 100, seekable)).toBe(30)
    expect(clampSeekTarget(50, 100, seekable)).toBe(50)
    expect(clampSeekTarget(70, 100, seekable)).toBe(60)
  })

  it('caps at finite duration if duration is shorter than seekable end', () => {
    expect(clampSeekTarget(50, 40, [[0, 60]])).toBe(40)
  })
})

describe('getBufferedEnd & getBufferedFraction', () => {
  it('returns 0 for empty or invalid ranges', () => {
    expect(getBufferedEnd([])).toBe(0)
    expect(getBufferedFraction([], 100)).toBe(0)
  })

  it('selects buffered end enclosing or ahead of currentTime', () => {
    const buffered = [[0, 30], [40, 60]] as const
    expect(getBufferedEnd(buffered, 15)).toBe(30)
    expect(getBufferedEnd(buffered, 45)).toBe(60)
    expect(getBufferedEnd(buffered, 35)).toBe(60)
    expect(getBufferedEnd([[5, 25]], 0)).toBe(25)
    expect(getBufferedEnd(buffered, 70)).toBe(0)
  })

  it('calculates fraction and handles edge cases', () => {
    const buffered = [[0, 30]] as const
    expect(getBufferedFraction(buffered, 100, 10)).toBe(0.3)
    expect(getBufferedFraction(buffered, 100)).toBe(0.3)
    expect(getBufferedFraction(buffered, 0)).toBe(0)
    expect(getBufferedFraction(buffered, -50)).toBe(0)
    expect(getBufferedFraction(buffered, NaN)).toBe(0)
    expect(getBufferedFraction(buffered, Infinity)).toBe(0)

    const overBuffered = [[0, 150]] as const
    expect(getBufferedFraction(overBuffered, 100)).toBe(1)
  })
})

describe('isResumeEligible', () => {
  it('is eligible for mid-video positions >= 10s', () => {
    expect(isResumeEligible(10, 100)).toBe(true)
    expect(isResumeEligible(50, 100)).toBe(true)
    expect(isResumeEligible(69, 100)).toBe(true)
  })

  it('rejects positions before 10s', () => {
    expect(isResumeEligible(0, 100)).toBe(false)
    expect(isResumeEligible(5, 100)).toBe(false)
    expect(isResumeEligible(9.9, 100)).toBe(false)
  })

  it('rejects positions within final 30s', () => {
    expect(isResumeEligible(70, 100)).toBe(false)
    expect(isResumeEligible(85, 100)).toBe(false)
    expect(isResumeEligible(99, 100)).toBe(false)
  })

  it('rejects positions within final 5% on long videos', () => {
    expect(isResumeEligible(949, 1000)).toBe(true) // 51s remaining = 5.1%
    expect(isResumeEligible(950, 1000)).toBe(false) // 50s remaining = 5.0%
    expect(isResumeEligible(960, 1000)).toBe(false) // 40s remaining = 4.0%
  })

  it('rejects invalid or live durations and positions', () => {
    expect(isResumeEligible(15, 20)).toBe(false) // duration < 30s
    expect(isResumeEligible(50, 0)).toBe(false)
    expect(isResumeEligible(50, -10)).toBe(false)
    expect(isResumeEligible(50, Infinity)).toBe(false)
    expect(isResumeEligible(NaN, 100)).toBe(false)
    expect(isResumeEligible(50, NaN)).toBe(false)
    expect(isResumeEligible(110, 100)).toBe(false)
    expect(isResumeEligible(-5, 100)).toBe(false)
  })
})

describe('stream display labels', () => {
  it('formats single stream labels from quality or kind', () => {
    expect(formatStreamLabel({ quality: '1080p', kind: 'hls', url: 'test' })).toBe('1080p')
    expect(formatStreamLabel({ quality: '  720p  ', kind: 'mp4', url: 'test' })).toBe('720p')
    expect(formatStreamLabel({ kind: 'hls', url: 'test' })).toBe('HLS')
    expect(formatStreamLabel({ kind: 'mp4', url: 'test' })).toBe('MP4')
  })

  it('generates distinct stream labels and preserves order', () => {
    const streams: StreamSource[] = [
      { quality: '1080p', kind: 'hls', url: '1' },
      { quality: '720p', kind: 'hls', url: '2' },
      { quality: '480p', kind: 'mp4', url: '3' }
    ]
    expect(getStreamLabels(streams)).toEqual(['1080p', '720p', '480p'])
  })

  it('disambiguates duplicate qualities using stream kind', () => {
    const streams: StreamSource[] = [
      { quality: '1080p', kind: 'hls', url: '1' },
      { quality: '1080p', kind: 'mp4', url: '2' },
      { quality: '720p', kind: 'hls', url: '3' }
    ]
    expect(getStreamLabels(streams)).toEqual(['1080p (HLS)', '1080p (MP4)', '720p'])
  })

  it('disambiguates identical quality and kind streams with an occurrence number', () => {
    const streams: StreamSource[] = [
      { quality: '1080p', kind: 'hls', url: '1' },
      { quality: '1080p', kind: 'hls', url: '2' },
      { kind: 'hls', url: '3' },
      { kind: 'hls', url: '4' }
    ]
    expect(getStreamLabels(streams)).toEqual([
      '1080p (HLS) (1)',
      '1080p (HLS) (2)',
      'HLS (1)',
      'HLS (2)'
    ])
  })

  it('handles empty stream list', () => {
    expect(getStreamLabels([])).toEqual([])
  })

  it('falls back in provider order without retrying duplicate streams', () => {
    const streams: StreamSource[] = [
      { quality: '1080p', kind: 'hls', url: 'https://video.test/master.m3u8', headers: { Referer: 'https://site.test' } },
      { quality: '1080p duplicate', kind: 'hls', url: 'https://video.test/master.m3u8', headers: { Referer: 'https://site.test' } },
      { quality: '720p', kind: 'mp4', url: 'https://video.test/video.mp4' }
    ]
    const attempted = new Set([getStreamIdentity(streams[0]!)])

    expect(findFallbackStreamIndex(streams, attempted)).toBe(2)
    attempted.add(getStreamIdentity(streams[2]!))
    expect(findFallbackStreamIndex(streams, attempted)).toBe(-1)
  })

  it('treats different custom headers as distinct streams', () => {
    const streams: StreamSource[] = [
      { kind: 'mp4', url: 'https://video.test/video.mp4', headers: { Authorization: 'one' } },
      { kind: 'mp4', url: 'https://video.test/video.mp4', headers: { Authorization: 'two' } }
    ]
    const attempted = new Set([getStreamIdentity(streams[0]!)])
    expect(findFallbackStreamIndex(streams, attempted)).toBe(1)
  })

  it('treats audio variants at the same URL as distinct streams', () => {
    const streams: StreamSource[] = [
      { kind: 'hls', url: 'https://video.test/master.m3u8', audio: 'Dublado' },
      { kind: 'hls', url: 'https://video.test/master.m3u8', audio: 'Legendado' }
    ]
    expect(getStreamIdentity(streams[0]!)).not.toBe(getStreamIdentity(streams[1]!))
  })

  it('never falls back across audio versions', () => {
    const streams: StreamSource[] = [
      { quality: '1080p', audio: 'Dublado', kind: 'hls', url: 'https://video.test/dub.m3u8' },
      { quality: '720p', audio: 'Legendado', kind: 'hls', url: 'https://video.test/leg.m3u8' }
    ]
    const attempted = new Set([getStreamIdentity(streams[0]!)])
    // Dublado failed and there is no other Dublado source: fail instead of
    // silently switching the language.
    expect(findFallbackStreamIndex(streams, attempted, 'Dublado')).toBe(-1)
    // Unlabelled sources (no audio metadata) keep the old provider-order behavior.
    const untagged: StreamSource[] = [
      { quality: '1080p', kind: 'hls', url: 'https://video.test/a.m3u8' },
      { quality: '720p', kind: 'hls', url: 'https://video.test/b.m3u8' }
    ]
    expect(findFallbackStreamIndex(untagged, new Set([getStreamIdentity(untagged[0]!)]))).toBe(1)
  })
})

describe('calculateSwipeUnlock', () => {
  it('unlocks on horizontal swipe reaching threshold upon release', () => {
    const res = calculateSwipeUnlock(SWIPE_UNLOCK_THRESHOLD, 0, true)
    expect(res.unlocked).toBe(true)
    expect(res.progress).toBe(1)
    expect(res.failed).toBe(false)
    expect(res.cancelled).toBe(false)
  })

  it('tracks progress during drag when horizontal motion dominates', () => {
    const res = calculateSwipeUnlock(36, 5, false)
    expect(res.progress).toBe(0.5)
    expect(res.unlocked).toBe(false)
    expect(res.failed).toBe(false)
    expect(res.cancelled).toBe(false)
  })

  it('fails when released before reaching threshold', () => {
    const res = calculateSwipeUnlock(50, 0, true)
    expect(res.unlocked).toBe(false)
    expect(res.failed).toBe(true)
    expect(res.cancelled).toBe(true)
  })

  it('fails and cancels when vertical motion dominates', () => {
    const duringDrag = calculateSwipeUnlock(50, 60, false)
    expect(duringDrag.progress).toBe(0)
    expect(duringDrag.unlocked).toBe(false)
    expect(duringDrag.failed).toBe(true)
    expect(duringDrag.cancelled).toBe(true)

    const onRelease = calculateSwipeUnlock(80, 80, true)
    expect(onRelease.unlocked).toBe(false)
    expect(onRelease.failed).toBe(true)
    expect(onRelease.cancelled).toBe(true)
  })

  it('fails on backward swipe (negative X)', () => {
    const res = calculateSwipeUnlock(-30, 0, false)
    expect(res.progress).toBe(0)
    expect(res.unlocked).toBe(false)
    expect(res.failed).toBe(true)
    expect(res.cancelled).toBe(true)
  })

  it('supports custom threshold', () => {
    const res = calculateSwipeUnlock(50, 0, true, 50)
    expect(res.unlocked).toBe(true)
    expect(res.progress).toBe(1)
  })

  it('fails on non-finite inputs', () => {
    const res = calculateSwipeUnlock(NaN, 0)
    expect(res.unlocked).toBe(false)
    expect(res.failed).toBe(true)
    expect(res.cancelled).toBe(true)
  })
})

describe('splitStreamOptions', () => {
  it('routes audio-labelled streams to the audio menu and keeps original indexes', () => {
    const streams: StreamSource[] = [
      { url: 'https://cdn.test/dub.m3u8', kind: 'hls', quality: '1080p', audio: 'Dublado' },
      { url: 'https://cdn.test/leg.m3u8', kind: 'hls', quality: '720p', audio: 'Legendado' }
    ]
    const split = splitStreamOptions(streams)
    expect(split.audio).toEqual([
      { value: 'stream:0', label: 'Dublado' },
      { value: 'stream:1', label: 'Legendado' }
    ])
    expect(split.quality).toEqual([])
  })

  it('keeps streams without audio in the quality menu with their deduped labels', () => {
    const streams: StreamSource[] = [
      { url: 'https://cdn.test/a.mp4', kind: 'mp4', quality: '720p' },
      { url: 'https://cdn.test/b.mp4', kind: 'mp4', quality: '720p' },
      { url: 'https://cdn.test/c.m3u8', kind: 'hls', quality: '1080p', audio: 'Dublado' }
    ]
    const split = splitStreamOptions(streams)
    expect(split.audio).toEqual([{ value: 'stream:2', label: 'Dublado' }])
    expect(split.quality).toEqual([
      { value: 'stream:0', label: '720p (MP4) (1)' },
      { value: 'stream:1', label: '720p (MP4) (2)' }
    ])
  })

  it('falls back to the kind when a stream has no quality label', () => {
    const split = splitStreamOptions([{ url: 'https://cdn.test/a.mp4', kind: 'mp4' }])
    expect(split.quality).toEqual([{ value: 'stream:0', label: 'MP4' }])
  })
})
