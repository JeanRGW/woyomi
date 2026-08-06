import type { FetchInit, FetchResult } from '@media-platform/core'

/** Web-mode scrape-proxy config (Settings > Web proxy). */
export interface ScrapeConfig {
  /** base URL of the self-hosted server; empty = proxy disabled (direct fetch) */
  url: string
  /** optional shared secret sent as `Authorization: Bearer <token>` */
  token: string
}

/** The scrape endpoint for a base URL (trailing slash normalized). */
export function proxyUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/scrape`
}

/**
 * Whether a target should route through the proxy. Requests to the proxy's
 * own origin (e.g. the plugin repo served from the same self-hosted server)
 * must NOT be proxied — the proxy's SSRF guard would reject them.
 */
export function shouldProxy(config: ScrapeConfig, url: string): boolean {
  if (!config.url) return false
  const target = new URL(url)
  const proxy = new URL(config.url)
  return target.origin !== proxy.origin
}

/** True for genuine network failures (fetch rejected); false for server responses. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError
}

/**
 * Route a plugin fetch through the scrape proxy. The server answers
 * `{ status, headers, body }`, which maps back to the plugin FetchResult.
 * A non-2xx proxy response throws with the server's message — but as a plain
 * Error (NOT a network failure), so it is not re-annotated with a proxy hint.
 */
export async function scrapeRequest(config: ScrapeConfig, url: string, init?: FetchInit): Promise<FetchResult> {
  const res = await fetch(proxyUrl(config.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
    body: JSON.stringify({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body })
  })
  const data = (await res.json()) as { status?: number; headers?: Record<string, string>; body?: string; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `scrape proxy -> HTTP ${res.status}`)
  }
  return { status: data.status ?? 0, headers: data.headers ?? {}, body: data.body ?? '' }
}

/**
 * Annotate a NETWORK failure (fetch itself rejected — CORS, DNS, unreachable
 * proxy) with a hint about the proxy. Server responses (4xx/5xx from the
 * proxy) carry their own message and must NOT be re-annotated.
 */
export function annotateFetchError(config: ScrapeConfig, error: unknown): Error {
  const err = error instanceof Error ? error : new Error(String(error))
  if (!config.url) {
    err.message = `${err.message} — this request needs a web proxy (HTML/CORS sources). Configure one in Settings > Web proxy.`
  } else {
    err.message = `${err.message} — web proxy at ${config.url} unreachable. Check the server is running, the URL, and the key in Settings > Web proxy.`
  }
  return err
}