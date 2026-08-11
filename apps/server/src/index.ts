import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

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

const OWNER_TOKEN = process.env.SYNC_TOKEN ?? 'changeme'
const DATA_DIR = process.env.DATA_DIR ?? './data'
const REPO_DIR = process.env.PLUGIN_REPO_DIR ?? resolve(import.meta.dirname ?? '.', '..', '..', '..')

// Read lazily so tests (and operators) can flip them without a restart.
const scrapeEnabled = () => process.env.SCRAPE_ENABLED === 'true'
const scrapeToken = () => process.env.SCRAPE_TOKEN
const SCRAPE_MAX_BYTES = 5 * 1024 * 1024
const SCRAPE_TIMEOUT_MS = 15_000

const app = new Hono()

// The web build (dev on :1420, or any origin in production) fetches /repo,
// /api/scrape and /api/sync cross-origin.
app.use('*', cors({ origin: '*', allowHeaders: ['content-type', 'authorization'] }))

app.get('/health', (c) => c.json({ ok: true }))

// Serve the aggregate plugin repo: index.json merges each plugin package's
// dist/index.json; bundles served from their real paths.
const repoDirs = [
  join(REPO_DIR, 'plugins', 'mangadex', 'dist'),
  join(REPO_DIR, 'plugins', 'examplevideo', 'dist'),
  join(REPO_DIR, 'plugins', 'tsundoku', 'dist')
]

app.get('/repo', async (c) => {
  const merged: { plugins: unknown[] } = { plugins: [] }
  for (const dir of repoDirs) {
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
  for (const dir of repoDirs) {
    const p = join(dir, file)
    if (p.startsWith(resolve(dir))) {
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
  method: z.string().default('GET'),
  headers: z.record(z.string()).default({}),
  body: z.string().optional()
})

/**
 * Reject loopback/private/link-local targets so the proxy can't be used to
 * hit the host's own network. ponytail: literal-IP + hostname blocklist only —
 * a DNS rebinding trick could still resolve a public name to a private IP.
 * Upgrade to resolving the target and re-checking the address if this is ever
 * exposed beyond trusted self-hosters.
 */
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/

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
  const token = scrapeToken()
  if (token && c.req.header('authorization') !== `Bearer ${token}`) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const parsed = ScrapeBody.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)

  const { url, method, headers, body } = parsed.data
  const target = new URL(url)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return c.json({ error: 'only http(s) targets are allowed' }, 400)
  }
  if (isPrivateTarget(target)) return c.json({ error: 'private targets are not allowed' }, 400)

  // Strip hop-by-hop/forbidden headers that would corrupt the upstream
  // request: content-length is set by fetch for the body, host identifies the
  // upstream, and authorization must stay the proxy's (if any), not a caller's.
  const upHeaders: Record<string, string> = { 'user-agent': 'woyomi/0.1 (+web)' }
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase()
    if (lk === 'content-length' || lk === 'host' || lk === 'authorization') continue
    upHeaders[k] = v
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: upHeaders,
      body,
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS)
    })
  } catch {
    return c.json({ error: 'upstream request failed or timed out' }, 502)
  }
  const outHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => (outHeaders[k] = v))
  const text = await res.text()
  if (text.length > SCRAPE_MAX_BYTES) {
    return c.json({ error: 'upstream response too large' }, 413)
  }
  return c.json({ status: res.status, headers: outHeaders, body: text })
})

function authed(c: { req: { header: (k: string) => string | undefined } }): boolean {
  return c.req.header('authorization') === `Bearer ${OWNER_TOKEN}`
}

const SyncBody = z.object({
  entries: z.array(z.any()),
  progress: z.array(z.any()),
  history: z.array(z.any()).optional()
})

app.get('/api/sync/:user', async (c) => {
  if (!authed(c)) return c.json({ error: 'unauthorized' }, 401)
  const user = c.req.param('user')
  try {
    return c.json(JSON.parse(await readFile(join(DATA_DIR, `${user}.json`), 'utf8')))
  } catch {
    return c.json({ entries: [], progress: [] })
  }
})

app.put('/api/sync/:user', async (c) => {
  if (!authed(c)) return c.json({ error: 'unauthorized' }, 401)
  const user = c.req.param('user')
  const parsed = SyncBody.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(join(DATA_DIR, `${user}.json`), JSON.stringify(parsed.data))
  return c.json({ ok: true })
})

export const server = app

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787)
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`woyomi server on http://localhost:${info.port}`)
  })
}
