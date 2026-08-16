import { describe, expect, it } from 'vitest'
import { ChapterContentSchema } from './protocol'

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
