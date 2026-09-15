import { describe, expect, it } from 'vitest'
import { ChapterContentSchema, StreamSourceSchema } from './protocol'

describe('ChapterContentSchema', () => {
  it('accepts pages with image request headers', () => {
    const parsed = ChapterContentSchema.parse({
      type: 'pages',
      images: ['https://cdn.test/1.jpg'],
      headers: { Referer: 'https://source.test/' }
    })
    expect(parsed).toEqual({
      type: 'pages',
      images: ['https://cdn.test/1.jpg'],
      headers: { Referer: 'https://source.test/' }
    })
  })

  it('keeps pages without headers and text content as before', () => {
    expect(ChapterContentSchema.parse({ type: 'pages', images: [] })).toEqual({ type: 'pages', images: [] })
    expect(ChapterContentSchema.parse({ type: 'text', html: '<p>hi</p>' })).toEqual({ type: 'text', html: '<p>hi</p>' })
  })
})

describe('StreamSourceSchema', () => {
  it('accepts dash manifests alongside hls and mp4', () => {
    expect(StreamSourceSchema.parse({ url: 'https://cdn.test/m.mpd', kind: 'dash' })).toEqual({
      url: 'https://cdn.test/m.mpd',
      kind: 'dash'
    })
    expect(StreamSourceSchema.parse({ url: 'https://cdn.test/m.m3u8', kind: 'hls' }).kind).toBe('hls')
    expect(StreamSourceSchema.parse({ url: 'https://cdn.test/v.mp4', kind: 'mp4' }).kind).toBe('mp4')
  })

  it('accepts an optional audio label for per-audio streams', () => {
    const parsed = StreamSourceSchema.parse({
      url: 'https://cdn.test/m.m3u8',
      kind: 'hls',
      quality: '1080p',
      audio: 'Dublado'
    })
    expect(parsed).toEqual({
      url: 'https://cdn.test/m.m3u8',
      kind: 'hls',
      quality: '1080p',
      audio: 'Dublado'
    })
    expect(StreamSourceSchema.parse({ url: 'https://cdn.test/m.m3u8', kind: 'hls' }).audio).toBeUndefined()
  })
})
