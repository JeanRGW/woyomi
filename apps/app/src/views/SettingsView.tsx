import { useCallback, useEffect, useState } from 'react'
import type { AppRuntime } from '../runtime'
import { isTauri } from '../runtime'
import { navigate } from '../App'
import { Btn, Page, SectionHeading, TextInput, Toggle } from '../components'
import { Icon } from '../icons'
import { scrapeRequest } from '../scrape'
import { pullSync, pushSync, syncConfigured, type SyncConfig } from '../sync'

export function SettingsView({ runtime }: { runtime: AppRuntime }) {
  const [plugins, setPlugins] = useState(runtime.registry.list())
  const [proxyUrlInput, setProxyUrlInput] = useState('')
  const [proxyToken, setProxyToken] = useState('')
  const [proxyStatus, setProxyStatus] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle')
  const [proxyError, setProxyError] = useState('')
  const [proxySaved, setProxySaved] = useState(false)
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({ server: '', user: '', token: '' })
  const [syncStatus, setSyncStatus] = useState<'idle' | 'running' | 'ok' | 'failed'>('idle')
  const [syncError, setSyncError] = useState('')
  const [syncSaved, setSyncSaved] = useState(false)

  const refresh = useCallback(() => setPlugins(runtime.registry.list()), [runtime])
  useEffect(() => {
    refresh()
    runtime.getScrapeConfig().then((cfg) => {
      setProxyUrlInput(cfg.url)
      setProxyToken(cfg.token)
    })
    runtime.getSyncConfig().then(setSyncConfig)
  }, [refresh, runtime])

  async function exportJson() {
    const json = await runtime.store.exportJson()
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'woyomi-library.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importJson(file: File) {
    await runtime.store.importJson(await file.text())
  }

  async function saveProxy() {
    await runtime.setScrapeConfig({ url: proxyUrlInput.trim(), token: proxyToken.trim() })
    setProxySaved(true)
    setProxyStatus('idle')
    window.setTimeout(() => setProxySaved(false), 2000)
  }

  async function testProxy() {
    setProxyStatus('testing')
    setProxyError('')
    try {
      const config = { url: proxyUrlInput.trim(), token: proxyToken.trim() }
      if (!config.url) throw new Error('Enter a server URL first')
      await scrapeRequest(config, 'https://example.com/')
      setProxyStatus('ok')
    } catch (e) {
      setProxyStatus('failed')
      setProxyError(e instanceof Error ? e.message : String(e))
    }
  }

  async function saveSync() {
    await runtime.setSyncConfig(syncConfig)
    setSyncSaved(true)
    window.setTimeout(() => setSyncSaved(false), 2000)
  }

  async function runSync(op: 'push' | 'pull') {
    if (!syncConfigured(syncConfig)) {
      setSyncError('Enter a server URL and user first')
      return
    }
    setSyncStatus('running')
    setSyncError('')
    try {
      if (op === 'push') await pushSync(runtime.store, syncConfig)
      else await pullSync(runtime.store, syncConfig)
      setSyncStatus('ok')
    } catch (e) {
      setSyncStatus('failed')
      setSyncError(e instanceof Error ? e.message : String(e))
    }
  }

  const prefsCount = plugins.filter((p) => (p.registration.manifest.prefs?.length ?? 0) > 0).length

  return (
    <Page>
      <div className="mb-5 md:mb-7">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Settings</h1>
      </div>

      <SectionHeading title="Plugins" />
      <div className="flex flex-col gap-2">
        {plugins.map((p) => (
          <div key={p.registration.manifest.id} className="flex items-center gap-3 rounded-2xl border border-line-soft bg-surface p-3.5">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
              <Icon name="plugins" size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <strong className="text-sm font-bold">{p.registration.manifest.name}</strong>
                <span className="text-xs text-faint">
                  v{p.registration.manifest.version} · {p.origin}
                </span>
              </div>
              {p.registration.manifest.description && <div className="truncate text-xs text-muted">{p.registration.manifest.description}</div>}
            </div>
            {p.origin === 'external' && (
              <Btn
                variant="danger"
                className="min-h-9 shrink-0 px-3 text-xs"
                onClick={() => {
                  runtime.uninstall(p.registration.manifest.id)
                  refresh()
                }}
              >
                Uninstall
              </Btn>
            )}
            <Toggle
              checked={p.enabled}
              label={`${p.enabled ? 'Disable' : 'Enable'} ${p.registration.manifest.name}`}
              onChange={() => {
                void runtime.setPluginEnabled(p.registration.manifest.id, !p.enabled).then(refresh)
              }}
            />
          </div>
        ))}
      </div>

      <button
        onClick={() => navigate({ name: 'plugin-settings' })}
        className="mt-3 flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-line-soft bg-surface p-3.5 text-left transition-colors hover:border-accent/50"
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon name="sliders" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Plugin settings</div>
          <div className="text-xs text-muted">
            {prefsCount > 0 ? `Options from ${prefsCount} plugin${prefsCount === 1 ? '' : 's'}` : 'Per-source toggles and plugin options'}
          </div>
        </div>
        <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />
      </button>

      {!isTauri() && (
        <>
          <SectionHeading title="Web proxy (scrape)" />
          <div className="rounded-2xl border border-line-soft bg-surface p-4">
            <p className="mb-3 text-xs text-muted">
              Used in the browser build to fetch sources that don't allow CORS (e.g. HTML scrapers). Leave the URL empty to use
              direct fetch. Point it at a self-hosted server with <code className="text-accent">SCRAPE_ENABLED=true</code>.
            </p>
            <div className="flex flex-col gap-2">
              <TextInput
                type="url"
                placeholder="https://your-server.example"
                value={proxyUrlInput}
                onChange={(e) => setProxyUrlInput(e.target.value)}
                aria-label="Proxy server URL"
              />
              <TextInput
                type="password"
                placeholder="Key (optional, matches SCRAPE_TOKEN)"
                value={proxyToken}
                onChange={(e) => setProxyToken(e.target.value)}
                aria-label="Proxy key"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Btn variant="soft" onClick={saveProxy} disabled={proxyStatus === 'testing'}>
                  Save proxy
                </Btn>
                <Btn variant="soft" onClick={testProxy} disabled={proxyStatus === 'testing'}>
                  {proxyStatus === 'testing' ? 'Testing…' : 'Test connection'}
                </Btn>
                {proxySaved && <span className="text-xs font-semibold text-ok">Saved</span>}
                {proxyStatus === 'ok' && <span className="text-xs font-semibold text-ok">OK</span>}
                {proxyStatus === 'failed' && <span className="text-xs font-semibold text-danger">{proxyError || 'Failed'}</span>}
              </div>
            </div>
          </div>
        </>
      )}

      <SectionHeading title="Library sync" />
      <div className="rounded-2xl border border-line-soft bg-surface p-4">
        <p className="mb-3 text-xs text-muted">Sync library, progress, and history with a self-hosted woyomi server.</p>
        <div className="flex flex-col gap-2">
          <TextInput
            type="url"
            placeholder="https://your-server.example"
            value={syncConfig.server}
            onChange={(e) => setSyncConfig((current) => ({ ...current, server: e.target.value }))}
            aria-label="Sync server URL"
          />
          <TextInput
            placeholder="User"
            value={syncConfig.user}
            onChange={(e) => setSyncConfig((current) => ({ ...current, user: e.target.value }))}
            aria-label="Sync user"
          />
          <TextInput
            type="password"
            placeholder="Token"
            value={syncConfig.token}
            onChange={(e) => setSyncConfig((current) => ({ ...current, token: e.target.value }))}
            aria-label="Sync token"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="soft" onClick={saveSync} disabled={syncStatus === 'running'}>
              Save sync
            </Btn>
            <Btn variant="soft" onClick={() => runSync('push')} disabled={syncStatus === 'running'}>
              Push now
            </Btn>
            <Btn variant="soft" onClick={() => runSync('pull')} disabled={syncStatus === 'running'}>
              Pull now
            </Btn>
            {syncSaved && <span className="text-xs font-semibold text-ok">Saved</span>}
            {syncStatus === 'running' && <span className="text-xs font-semibold text-muted">Syncing…</span>}
            {syncStatus === 'ok' && <span className="text-xs font-semibold text-ok">OK</span>}
            {syncStatus === 'failed' && <span className="text-xs font-semibold text-danger">{syncError || 'Failed'}</span>}
          </div>
          {syncStatus === 'idle' && syncError && <div className="text-xs font-semibold text-danger">{syncError}</div>}
        </div>
      </div>

      <SectionHeading title="Data" />
      <div className="flex flex-col gap-2 rounded-2xl border border-line-soft bg-surface p-4 sm:flex-row">
        <Btn variant="soft" onClick={exportJson} className="flex-1">
          <Icon name="download" size={16} />
          Export library
        </Btn>
        <label className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 text-sm font-semibold transition-all hover:bg-surface-3 active:scale-[0.97]">
          <Icon name="upload" size={16} />
          Import library
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
      </div>
    </Page>
  )
}
