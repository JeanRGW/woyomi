import type { FetchFn, FetchResult } from './types.js'

export const jsonHeaders = (extra?: Record<string, string>) => ({
  accept: 'application/json',
  ...extra
})

/** Thin helper: fetch + JSON parse, throwing a descriptive error on failure. */
export async function fetchJson<T>(
  fetch: FetchFn,
  url: string,
  init?: Parameters<FetchFn>[1]
): Promise<T> {
  const res = await fetch(url, init)
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`)
  }
  try {
    return JSON.parse(res.body) as T
  } catch {
    throw new Error(`GET ${url} -> response is not valid JSON`)
  }
}

/** Helper for plugins that scrape HTML: fetch and return the raw body. */
export async function fetchHtml(fetch: FetchFn, url: string): Promise<string> {
  const res: FetchResult = await fetch(url, { headers: { accept: 'text/html,*/*' } })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`)
  }
  return res.body
}
