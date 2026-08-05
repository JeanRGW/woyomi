import { z } from 'zod'
import type { FetchFn } from '@media-platform/core'

/**
 * External plugin providers (Mihon/Aniyomi-style repos): a static URL serving
 * an `index.json` of plugin artifacts. The index drives the store UI; install
 * downloads the bundle + manifest, verifies sha256, then loads it into the app.
 */

export interface RepoPlugin {
  id: string
  name: string
  version: string
  apiVersion: number
  lang?: string
  nsfw?: boolean
  description?: string
  mediaTypes: string[]
  /** absolute URL to the .plugin.js bundle */
  url: string
  /** absolute URL to the .plugin.json */
  manifestUrl: string
  /** sha256 of the bundle */
  sha256: string
  iconUrl?: string
}

const RepoIndexSchema = z.object({
  plugins: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      apiVersion: z.number(),
      lang: z.string().optional(),
      nsfw: z.boolean().optional(),
      description: z.string().optional(),
      mediaTypes: z.array(z.string()),
      file: z.string(),
      sha256: z.string(),
      icon: z.string().optional()
    })
  )
})

export function resolveUrl(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : base + '/').toString()
}

/** base for resolving relative artifact paths = the directory containing index.json */
export function repoBase(indexUrl: string): string {
  const url = new URL(indexUrl)
  const path = url.pathname.replace(/\/[^/]*$/, '/')
  return url.origin + path
}

export async function fetchRepoIndex(fetch: FetchFn, repoUrl: string): Promise<RepoPlugin[]> {
  const indexUrl = repoUrl.endsWith('/index.json') ? repoUrl : repoUrl.endsWith('/') ? repoUrl + 'index.json' : repoUrl + '/index.json'
  const res = await fetch(indexUrl)
  if (res.status < 200 || res.status >= 300) throw new Error(`repo ${repoUrl} -> HTTP ${res.status}`)
  const parsed = RepoIndexSchema.safeParse(JSON.parse(res.body))
  if (!parsed.success) throw new Error(`invalid repo index: ${parsed.error.message}`)
  const base = repoBase(indexUrl)
  return parsed.data.plugins.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    apiVersion: p.apiVersion,
    lang: p.lang,
    nsfw: p.nsfw,
    description: p.description,
    mediaTypes: p.mediaTypes,
    url: resolveUrl(base, p.file),
    manifestUrl: resolveUrl(base, p.file.replace(/\.plugin\.js$/, '.plugin.json')),
    sha256: p.sha256,
    iconUrl: p.icon ? resolveUrl(base, p.icon) : undefined
  }))
}
