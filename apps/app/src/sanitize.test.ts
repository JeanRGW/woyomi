// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('keeps benign formatting', () => {
    const html = '<p>Hello <strong>world</strong>, <ruby>漢<rt>かん</rt></ruby></p><ul><li>one</li></ul>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('strips script elements', () => {
    const out = sanitizeHtml('<p>hi</p><script>window.__TAURI_INTERNALS__.invoke("evil")</script>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('invoke')
  })

  it('strips inline event handlers', () => {
    const out = sanitizeHtml('<img src="https://example.com/a.png" onerror="alert(1)">')
    expect(out).not.toContain('onerror')
    expect(out).toContain('src="https://example.com/a.png"')
  })

  it('strips javascript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
  })

  it('strips frames, forms and style elements/attributes', () => {
    const out = sanitizeHtml(
      '<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="x"></form><style>body{display:none}</style><div style="position:fixed">overlay</div>'
    )
    expect(out).not.toContain('iframe')
    expect(out).not.toContain('form')
    expect(out).not.toContain('input')
    expect(out).not.toContain('<style')
    expect(out).not.toContain('style=')
    expect(out).toContain('overlay')
  })

  it('neutralizes svg-based mutation payloads', () => {
    const out = sanitizeHtml('<svg><p><style><a title="</style><img src=x onerror=alert(1)>"></p></svg>')
    expect(out).not.toContain('onerror')
  })

  it('sanitizes raw HTML passed through by marked', () => {
    const rendered = marked.parse('Title\n\n<img src=x onerror="alert(1)"><script>evil()</script>', { async: false })
    const out = sanitizeHtml(rendered)
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('script')
    expect(out).toContain('Title')
  })
})
