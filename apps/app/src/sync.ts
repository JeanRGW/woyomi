import type { LibraryStore } from '@woyomi/core'

export interface SyncConfig {
  server: string
  user: string
  token: string
}

export function syncConfigured(config: SyncConfig): boolean {
  return config.server.trim() !== '' && config.user.trim() !== ''
}

function syncUrl(config: SyncConfig): string {
  return `${config.server.trim().replace(/\/+$/, '')}/api/sync/${encodeURIComponent(config.user.trim())}`
}

function syncInit(config: SyncConfig, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...init.headers, ...(config.token.trim() ? { authorization: `Bearer ${config.token.trim()}` } : {}) },
    signal: init.signal ?? AbortSignal.timeout(15_000)
  }
}

function throwHttp(res: Response, verb: string): never {
  throw new Error(`sync ${verb} -> HTTP ${res.status}`)
}

export async function pushSync(store: LibraryStore, config: SyncConfig): Promise<void> {
  const res = await fetch(
    syncUrl(config),
    syncInit(config, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: await store.exportJson() })
  )
  if (!res.ok) throwHttp(res, 'push')
}

export async function pullSync(store: LibraryStore, config: SyncConfig): Promise<void> {
  const res = await fetch(syncUrl(config), syncInit(config))
  if (!res.ok) throwHttp(res, 'pull')
  await store.importJson(await res.text())
}
