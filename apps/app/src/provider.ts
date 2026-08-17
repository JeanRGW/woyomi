import { z } from 'zod'
import type { FetchFn } from '@woyomi/core'

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
  /** Languages the plugin supports; a repo may declare a single code or an array. */
  lang: string[]
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

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** True only when candidate is a valid SemVer newer than current. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = SEMVER_RE.exec(candidate)
  const installed = SEMVER_RE.exec(current)
  if (!next || !installed) return false

  for (let i = 1; i <= 3; i++) {
    const difference = Number(next[i]) - Number(installed[i])
    if (difference !== 0) return difference > 0
  }

  const nextPrerelease = next[4]?.split('.')
  const installedPrerelease = installed[4]?.split('.')
  if (!nextPrerelease || !installedPrerelease) return !nextPrerelease && !!installedPrerelease

  for (let i = 0; i < Math.max(nextPrerelease.length, installedPrerelease.length); i++) {
    const a = nextPrerelease[i]
    const b = installedPrerelease[i]
    if (a === undefined || b === undefined) return b === undefined
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Number(a) > Number(b)
    if (aNumeric !== bNumeric) return !aNumeric
    return a > b
  }
  return false
}

const RepoIndexSchema = z.object({
  plugins: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      apiVersion: z.number(),
      lang: z.union([z.string(), z.array(z.string())]).optional(),
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

/** Normalize a repo's `lang` (single code or array) into a stable array. */
function normalizeLang(lang: string | string[] | undefined): string[] {
  if (Array.isArray(lang)) return lang
  return lang ? [lang] : []
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
    lang: normalizeLang(p.lang),
    nsfw: p.nsfw,
    description: p.description,
    mediaTypes: p.mediaTypes,
    url: resolveUrl(base, p.file),
    manifestUrl: resolveUrl(base, p.file.replace(/\.plugin\.js$/, '.plugin.json')),
    sha256: p.sha256,
    iconUrl: p.icon ? resolveUrl(base, p.icon) : undefined
  }))
}
