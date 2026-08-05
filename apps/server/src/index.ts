import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

/**
 * Optional self-hosted backend for the web build.
 *  - POST /api/scrape  : CORS-free fetch proxy (plugins in web mode)
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

const app = new Hono()

// The web build (dev on :1420, or any origin in production) fetches /repo,
// /api/scrape and /api/sync cross-origin.
app.use('*', cors({ origin: '*', allowHeaders: ['content-type', 'authorization'] }))

app.get('/health', (c) => c.json({ ok: true }))

// Serve the aggregate plugin repo: index.json merges each plugin package's
// dist/index.json; bundles served from their real paths.
const repoDirs = [
  join(REPO_DIR, 'plugins', 'mangadex', 'dist'),
  join(REPO_DIR, 'plugins', 'examplevideo', 'dist')
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

app.post('/api/scrape', async (c) => {
  const parsed = ScrapeBody.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400)

  const { url, method, headers, body } = parsed.data
  const res = await fetch(url, { method, headers: { 'user-agent': 'media-platform/0.1 (+web)', ...headers }, body })
  const text = await res.text()
  const outHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => (outHeaders[k] = v))
  return c.json({ status: res.status, headers: outHeaders, body: text })
})

function authed(c: { req: { header: (k: string) => string | undefined } }): boolean {
  return c.req.header('authorization') === `Bearer ${OWNER_TOKEN}`
}

const SyncBody = z.object({
  entries: z.array(z.any()),
  progress: z.array(z.any())
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
    console.log(`media-platform server on http://localhost:${info.port}`)
  })
}
