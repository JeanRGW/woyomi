import 'dotenv/config'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { mergeSyncPayload, SyncPayloadSchema, type SyncPayload } from '@woyomi/core'

/**
 * Optional self-hosted backend for the web build.
 *  - POST /api/scrape  : CORS-free fetch proxy (plugins in web mode). Off by
 *    default (SCRAPE_ENABLED) so our hosted server isn't an open proxy; a
 *    self-hoster opts in and can gate it with SCRAPE_TOKEN.
 *  - GET  /api/sync/:user : export library/progress JSON
 *  - PUT  /api/sync/:user : import library/progress JSON
 *  - GET  /repo/**: serves a plugin repo (index.json + bundles) from
 *    PLUGIN_REPO_DIR, defaulting to the monorepo's plugins dist dirs.
 * Library state is kept per-user as a JSON file on disk — the app is the
 * source of truth, this is a sync bus, not a database.
 * ponytail: file-backed, single-owner. Switch to Postgres/Drizzle if
 * multi-user or higher-volume sync is ever wanted.
 */

// Read lazily so tests (+ tools) can point the repo at a fixture dir.
const repoDir = () => process.env.PLUGIN_REPO_DIR ?? resolve(import.meta.dirname ?? '.', '..', '..', '..')

// Read lazily so tests (+ tools) can point sync state at a throwaway dir.
const dataDir = () => process.env.DATA_DIR ?? './data'

// Read lazily so tests (and operators) can flip them without a restart.
const scrapeEnabled = () => process.env.SCRAPE_ENABLED === 'true'
const scrapeToken = () => process.env.SCRAPE_TOKEN
const SCRAPE_MAX_BYTES = 5 * 1024 * 1024
const SCRAPE_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const MAX_REQUEST_JSON_BYTES = 1024 * 1024

const app = new Hono()

// The web build (dev on :1420, or any origin in production) fetches /repo,
// /api/scrape and /api/sync cross-origin.
app.use('*', cors({ origin: '*', allowHeaders: ['content-type', 'authorization'] }))

app.get('/health', (c) => c.json({ ok: true }))

// Serve the aggregate plugin repo: index.json merges each plugin package's
// dist/index.json; bundles served from their real paths. Plugin dirs are
// discovered per request so no plugin has to be hardcoded and newly added
// dirs show up without a restart; an empty/missing plugins dir serves an
// empty index.
const repoDirs = async (): Promise<string[]> => {
  const pluginsDir = join(repoDir(), 'plugins')
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => join(pluginsDir, e.name, 'dist'))
  } catch {
    return []
  }
}

app.get('/repo', async (c) => {
  const merged: { plugins: unknown[] } = { plugins: [] }
  for (const dir of await repoDirs()) {
    try {
      const idx = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as { plugins: Array<{ file: string }> }
      merged.plugins.push(...idx.plugins.map((p) => ({ ...p, file: `/repo/${p.file}` })))
    } catch {
      /* dir may not have been built yet */
    }
  }
  return c.json(merged)
})

app.get('/repo/:file', async (c) => {
  const file = c.req.param('file')
  for (const dir of await repoDirs()) {
    const root = resolve(dir)
    const p = resolve(root, file)
    if (p.startsWith(root + sep)) {
      try {
        const body = await readFile(p, 'utf8')
        const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : 'text/plain'
        return c.body(body, 200, { 'content-type': contentType })
      } catch {
        /* continue */
      }
    }
  }
  return c.body('not found', 404)
})


const ScrapeBody = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string()).default({}),
  body: z.string().optional()
})

/** Constant-time token comparison (hashing both sides equalizes lengths first). */
function safeTokenEqual(expected: string, provided: string | undefined): boolean {
  if (provided === undefined || provided.length === 0) return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(provided).digest()
  return timingSafeEqual(a, b)
}

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer (.+)$/i.exec(header ?? '')
  return match?.[1]
}

/**
 * Scrape/stream gate: compares SCRAPE_TOKEN against the Authorization header,
 * or (for `<video>`/`<img>` which cannot send headers) the `?token=` query
 * param. ponytail: token-in-query is a log smell; fine for a personal
 * self-hosted box. Comparisons are constant-time.
 */
function scrapeAuthorized(c: Context): boolean {
  const token = scrapeToken()
  if (!token) return true
  return safeTokenEqual(token, bearerToken(c.req.header('authorization'))) || safeTokenEqual(token, c.req.query('token'))
}

/**
 * Request headers that must never be forwarded upstream: they would corrupt
 * the request framing, impersonate the upstream host, or leak the proxy's own
 * credentials. Applied case-insensitively.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'authorization',
  'connection',
  'transfer-encoding',
  'te',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
  'proxy-connection'
])

/** Response headers that must never be echoed back to the caller. */
const STRIPPED_RESPONSE_HEADERS = new Set(['transfer-encoding', 'connection', 'set-cookie', 'set-cookie2'])

function forwardRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const up: Record<string, string> = { 'user-agent': 'woyomi/0.1 (+web)' }
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase()
    if (STRIPPED_REQUEST_HEADERS.has(lk)) continue
    if (typeof v !== 'string') continue
    up[lk] = v
  }
  return up
}

function forwardResponseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase())) out[k] = v
  })
  return out
}

/**
 * Read a JSON body with a size cap. Returns `tooLarge` for oversized bodies
 * and `undefined` for malformed JSON so handlers can answer 400/413 instead
 * of crashing with an unhandled parse error.
 */
async function readJsonBody(c: Context): Promise<{ value: unknown } | { tooLarge: true } | undefined> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_REQUEST_JSON_BYTES) return { tooLarge: true }
  const reader = c.req.raw.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_REQUEST_JSON_BYTES) {
        await reader.cancel()
        return { tooLarge: true }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const text = Buffer.concat(chunks, bytes).toString('utf8')
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

/**
 * Reject loopback/private/link-local targets so the proxy can't be used to
 * hit the host's own network. ponytail: literal-IP + hostname blocklist only —
 * a DNS rebinding trick could still resolve a public name to a private IP.
 * Upgrade to resolving the target and re-checking the address if this is ever
 * exposed beyond trusted self-hosters.
 */
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/

class ResponseTooLargeError extends Error {}

function syncFile(user: string): string {
  // Encode the route parameter before using it as a filename. This preserves
  // existing simple usernames while making separators and traversal segments inert.
  return join(dataDir(), `${encodeURIComponent(user)}.json`)
}

async function fetchPublic(url: string, init: RequestInit): Promise<Response> {
  let currentUrl = url
  for (let redirectCount = 0; ; redirectCount += 1) {
    const target = new URL(currentUrl)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new Error('only http(s) targets are allowed')
    }
    if (isPrivateTarget(target)) throw new Error('private targets are not allowed')

    const response = await fetch(currentUrl, { ...init, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response

    const location = response.headers.get('location')
    if (!location) return response
    if (redirectCount >= MAX_REDIRECTS) throw new Error('too many upstream redirects')
    await response.body?.cancel()
    currentUrl = new URL(location, target).toString()
  }
}

async function readCappedBody(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      size += value.byteLength
      if (size > SCRAPE_MAX_BYTES) throw new ResponseTooLargeError('upstream response too large')
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function isPrivateTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1') return true
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) forms embed a
  // private IPv4 — decode it and fall through to the IPv4 check. The URL
  // parser may keep the dotted-quad form or fold it into hex groups
  // (::ffff:7f00:1), so accept both.
  const embedded = host.match(/^(?:(?:::ffff:)|64:ff9b::)(.+)$/)
  let candidate = host
  if (embedded) {
    const tail = embedded[1]!
    if (tail.includes('.')) {
      candidate = tail
    } else {
      const parts = tail.split(':')
      const hi = parts.at(-2)
      const lo = parts.at(-1)
      if (hi !== undefined && lo !== undefined) {
        const h = Number.parseInt(hi, 16)
        const l = Number.parseInt(lo, 16)
        candidate = `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`
      }
    }
  }
  if (PRIVATE_IP.test(candidate)) return true
  // IPv6: block loopback, unique-local (fc/fd) and link-local (fe80) prefixes
  return host.includes(':') && (host.startsWith('::') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))
}

app.post('/api/scrape', async (c) => {
  if (!scrapeEnabled()) return c.json({ error: 'scrape proxy disabled' }, 403)
  if (!scrapeAuthorized(c)) return c.json({ error: 'unauthorized' }, 401)

  const body = await readJsonBody(c)
  if (body === undefined) return c.json({ error: 'malformed JSON body' }, 400)
  if ('tooLarge' in body) return c.json({ error: 'request body too large' }, 413)

  const parsed = ScrapeBody.safeParse(body.value)
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)

  const { url, method, headers, body: upBody } = parsed.data
  const target = new URL(url)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return c.json({ error: 'only http(s) targets are allowed' }, 400)
  }
  if (isPrivateTarget(target)) return c.json({ error: 'private targets are not allowed' }, 400)

  // Strip hop-by-hop/forbidden headers that would corrupt the upstream request
  // (see STRIPPED_REQUEST_HEADERS); content-length is set by fetch for the body.
  const upHeaders = forwardRequestHeaders(headers)

  let res: Response
  try {
    res = await fetchPublic(url, {
      method,
      headers: upHeaders,
      body: upBody,
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof ResponseTooLargeError) return c.json({ error: error.message }, 413)
    return c.json({ error: 'upstream request failed or timed out' }, 502)
  }
  const outHeaders = forwardResponseHeaders(res)
  let text: string
  try {
    text = await readCappedBody(res)
  } catch (error) {
    if (error instanceof ResponseTooLargeError) return c.json({ error: error.message }, 413)
    return c.json({ error: 'failed to read upstream response' }, 502)
  }
  return c.json({ status: res.status, headers: outHeaders, body: text })
})

/**
 * Stream media for the web build: applies caller-supplied headers (e.g. a
 * Referer) and forwards Range for <video> seeking. Gated
 * like /api/scrape (SCRAPE_ENABLED + optional SCRAPE_TOKEN via ?token=).
 * <video> can't send headers, so the token travels in the query string.
 * ponytail: token-in-query is a log smell; fine for a personal self-hosted box.
 * Reuses the scrape proxy's SSRF guard verbatim.
 */
app.get('/api/stream', async (c) => {
  if (!scrapeEnabled()) return c.json({ error: 'scrape proxy disabled' }, 403)
  if (!scrapeAuthorized(c)) return c.json({ error: 'unauthorized' }, 401)

  const target = c.req.query('url')
  const headersJson = c.req.query('headers')
  if (!target) return c.json({ error: 'missing url param' }, 400)
  let parsedTarget: URL
  try {
    parsedTarget = new URL(target)
  } catch {
    return c.json({ error: 'bad url param' }, 400)
  }
  if (parsedTarget.protocol !== 'https:' && parsedTarget.protocol !== 'http:') {
    return c.json({ error: 'only http(s) targets are allowed' }, 400)
  }
  if (isPrivateTarget(parsedTarget)) return c.json({ error: 'private targets are not allowed' }, 400)

  let headers: Record<string, string> = {}
  if (headersJson) {
    try {
      const parsed = JSON.parse(headersJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        headers = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      }
    } catch {
      return c.json({ error: 'bad headers param' }, 400)
    }
  }

  const upHeaders = forwardRequestHeaders(headers)

  const range = c.req.header('range')

  let res: Response
  try {
    res = await fetchPublic(target, {
      method: 'GET',
      headers: range ? { ...upHeaders, range } : upHeaders,
      // Do not apply the scrape timeout to the response body: media streams
      // can legitimately remain open for longer than fifteen seconds.
    })
  } catch {
    return c.json({ error: 'upstream request failed or timed out' }, 502)
  }

  const outHeaders = forwardResponseHeaders(res)
  if (!res.body) return c.json({ error: 'upstream returned no body' }, 502)
  return c.body(res.body as ReadableStream, res.status as never, outHeaders as Record<string, string>)
})

function authed(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const token = process.env.SYNC_TOKEN?.trim()
  return token !== undefined && token.length > 0 && safeTokenEqual(token, bearerToken(c.req.header('authorization')))
}

const EMPTY_PAYLOAD: SyncPayload = {
  version: 1,
  entries: [],
  progress: [],
  history: [],
  tombstones: { entries: [], progress: [], history: [] }
}

/**
 * Read a user's stored payload, validating its shape. A missing file is an
 * empty payload; a corrupt file is quarantined (renamed, not overwritten) and
 * logged so the next write cannot silently destroy it.
 */
async function readStoredPayload(user: string): Promise<SyncPayload> {
  const file = syncFile(user)
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = SyncPayloadSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
    console.warn(`woyomi server: invalid payload shape in ${file}; quarantining`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_PAYLOAD
    console.warn(`woyomi server: unreadable sync file ${file}; quarantining`)
  }
  await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined)
  return EMPTY_PAYLOAD
}

/** Write the payload atomically (tmp + rename) so a crash can't leave a half-written file. */
async function writeStoredPayload(user: string, payload: SyncPayload): Promise<void> {
  const file = syncFile(user)
  await mkdir(dataDir(), { recursive: true })
  const tmp = `${file}.tmp-${Date.now()}`
  await writeFile(tmp, JSON.stringify(payload))
  await rename(tmp, file)
}

// Per-user in-process lock: concurrent PUTs serialize instead of losing updates
// (read-modify-write must not interleave). ponytail: single-process only.
const userLocks = new Map<string, Promise<void>>()
function withUserLock<T>(user: string, fn: () => Promise<T>): Promise<T> {
  const prev = userLocks.get(user) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  userLocks.set(user, next.then(() => undefined, () => undefined))
  return next
}

/**
 * Order-independent, idempotent merge of two library snapshots (the stored one
 * and a client's full export). Single implementation lives in @woyomi/core so
 * every client applies identical semantics. Exported under the historical name
 * for tests and callers.
 */
export const mergeLibraries = mergeSyncPayload

app.get('/api/sync/:user', async (c) => {
  if (!authed(c)) return c.json({ error: 'unauthorized' }, 401)
  return c.json(await readStoredPayload(c.req.param('user')))
})

app.put('/api/sync/:user', async (c) => {
  if (!authed(c)) return c.json({ error: 'unauthorized' }, 401)
  const user = c.req.param('user')
  const body = await readJsonBody(c)
  if (body === undefined) return c.json({ error: 'malformed JSON body' }, 400)
  if ('tooLarge' in body) return c.json({ error: 'request body too large' }, 413)
  const parsed = SyncPayloadSchema.safeParse(body.value)
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)
  const merged = await withUserLock(user, async () => {
    const stored = await readStoredPayload(user)
    const result = mergeSyncPayload(stored, parsed.data)
    await writeStoredPayload(user, result)
    return result
  })
  return c.json(merged)
})

export const server = app

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787)
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`woyomi server on http://localhost:${info.port}`)
  })
}
