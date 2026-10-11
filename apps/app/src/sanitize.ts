import DOMPurify from 'dompurify'

/**
 * Sanitize untrusted HTML (plugin-provided synopses and chapter bodies) before it
 * is injected via `dangerouslySetInnerHTML`. Scripts, event handlers, frames,
 * forms and style attributes are stripped; only conservative formatting
 * elements and attributes survive. URL attributes fall back to DOMPurify's
 * default scheme policy (http(s), mailto/tel/etc.; `data:` only where
 * DOMPurify allows it for media), so no script-capable URL survives.
 */
const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  'rp', 'rt', 'ruby', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
]

const ALLOWED_ATTR = ['alt', 'class', 'colspan', 'height', 'href', 'id', 'rowspan', 'src', 'title', 'width']

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false
  })
}
