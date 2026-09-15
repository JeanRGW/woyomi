import { describe, expect, it } from 'vitest'
import { rewriteDashManifest, rewriteHlsPlaylist } from './runtime'

const REAL = 'https://akumast.net/i/ABC123/m.jpg'
const HEADERS = encodeURIComponent(JSON.stringify({ Referer: 'https://animefire.io/' }))
const PROXIED = `http://127.0.0.1:5123/stream?url=${encodeURIComponent(REAL)}&headers=${HEADERS}`

const MANIFEST = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet contentType="video">
      <SegmentTemplate media="/i/ABC123/$RepresentationID$/$Number$.jpg" initialization="/i/ABC123/$RepresentationID$/i.jpg" />
    </AdaptationSet>
  </Period>
</MPD>`

describe('rewriteDashManifest', () => {
  it('wraps root-relative templates in the stream proxy, preserving $ variables', () => {
    const out = rewriteDashManifest(MANIFEST, REAL, PROXIED)
    expect(out).toContain('$RepresentationID$')
    expect(out).toContain('$Number$')
    expect(out).not.toContain('media="/i/')
    expect(out).toContain('http://127.0.0.1:5123/stream?url=')
    expect(out).toContain(encodeURIComponent('https://akumast.net/i/ABC123/').slice(0, 20))
  })

  it('keeps foreign absolute URLs untouched', () => {
    const withForeign = MANIFEST.replace(
      '</MPD>',
      '<Other media="https://drm.test/license" /></MPD>'
    )
    const out = rewriteDashManifest(withForeign, REAL, PROXIED)
    expect(out).toContain('media="https://drm.test/license"')
  })

  it('no-ops when the manifest is not proxied', () => {
    expect(rewriteDashManifest(MANIFEST, REAL, REAL)).toBe(MANIFEST)
  })

  it('emits well-formed XML: separators escaped, decodable back to template URLs', () => {
    const out = rewriteDashManifest(MANIFEST, REAL, PROXIED)
    // A raw `&` separator is illegal in XML attributes and made dash.js fail
    // manifest parsing (code 10); `&amp;` decodes back on parse.
    expect(out).not.toMatch(/&(headers|token)=/)
    expect(out).toContain('&amp;headers=')
    expect(out).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/)
    const decoded = out.replaceAll('&amp;', '&')
    expect(decoded).toContain('$RepresentationID$')
    expect(decoded).toContain('$Number$')
    expect(decoded).toContain('url=https%3A%2F%2Fakumast.net%2Fi%2FABC123%2F')
  })
})

const REAL_HLS = 'https://akumast.net/i/ABC123/h.jpg'
const PROXIED_HLS = `http://127.0.0.1:5123/stream?url=${encodeURIComponent(REAL_HLS)}&headers=${HEADERS}`

/** Expected wrapped form of an upstream URI. */
const wrapped = (absolute: string): string =>
  `http://127.0.0.1:5123/stream?url=${encodeURIComponent(absolute)}&headers=${HEADERS}`

describe('rewriteHlsPlaylist', () => {
  it('wraps relative variant URIs, keeps foreign/data URIs and tags untouched', () => {
    const master = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=984234,RESOLUTION=854x480
DFt9TQ-CscU/p.jpg
#EXT-X-STREAM-INF:BANDWIDTH=3367191,RESOLUTION=1920x1080
https://cdn.test/1080/p.jpg
#EXT-X-STREAM-INF:BANDWIDTH=100
data:application/vnd.apple.mpegurl;base64,QUJD`
    const out = rewriteHlsPlaylist(master, PROXIED_HLS)
    expect(out).toContain('#EXT-X-VERSION:6')
    expect(out).toContain(`\n${wrapped('https://akumast.net/i/ABC123/DFt9TQ-CscU/p.jpg')}\n`)
    expect(out).not.toContain('\nDFt9TQ-CscU/p.jpg\n')
    // CDNs that serve their own CORS keep direct URLs
    expect(out).toContain('https://cdn.test/1080/p.jpg')
    expect(out).toContain('data:application/vnd.apple.mpegurl;base64,QUJD')
  })

  it('wraps media playlists: EXT-X-MAP init sections and segments', () => {
    const media = `#EXTM3U
#EXT-X-MAP:URI="i.jpg"
#EXTINF:6.000,
1.jpg
#EXTINF:6.000,
2.jpg?st=abc`
    const out = rewriteHlsPlaylist(media, PROXIED_HLS)
    expect(out).not.toMatch(/URI="i\.jpg"/)
    expect(out).toContain(`URI="${wrapped('https://akumast.net/i/ABC123/i.jpg')}"`)
    expect(out).toContain(wrapped('https://akumast.net/i/ABC123/1.jpg'))
    expect(out).toContain(wrapped('https://akumast.net/i/ABC123/2.jpg?st=abc'))
  })

  it('keeps resolved paths when the playlist sits in a subdirectory', () => {
    const sub = 'https://akumast.net/i/ABC123/DFt9TQ-CscU/p.jpg'
    const proxiedSub = `http://127.0.0.1:5123/stream?url=${encodeURIComponent(sub)}&headers=${HEADERS}`
    const out = rewriteHlsPlaylist('#EXTM3U\n1.jpg\n../other/2.jpg', proxiedSub)
    expect(out).toContain(wrapped('https://akumast.net/i/ABC123/DFt9TQ-CscU/1.jpg'))
    expect(out).toContain(wrapped('https://akumast.net/i/ABC123/other/2.jpg'))
  })

  it('preserves the web proxy token on wrapped URIs', () => {
    const proxied = `${PROXIED_HLS}&token=secret`
    const out = rewriteHlsPlaylist('#EXTM3U\n1.jpg', proxied)
    expect(out).toContain(`&token=secret`)
  })

  it('no-ops when the playlist is not proxied', () => {
    const master = '#EXTM3U\nDFt9TQ-CscU/p.jpg'
    expect(rewriteHlsPlaylist(master, REAL_HLS)).toBe(master)
  })
})
