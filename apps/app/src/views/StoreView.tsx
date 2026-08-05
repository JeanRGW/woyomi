import { useEffect, useState } from 'react'
import { fetchRepoIndex, type RepoPlugin } from '../provider'
import type { AppRuntime } from '../runtime'
import { createFetchProvider } from '../runtime'

const DEFAULT_REPOS = ['http://localhost:8787/repo']

export function StoreView({ runtime }: { runtime: AppRuntime }) {
  const [repos, setRepos] = useState<string[]>(DEFAULT_REPOS)
  const [repoInput, setRepoInput] = useState('')
  const [plugins, setPlugins] = useState<RepoPlugin[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const provider = createFetchProvider()

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos])

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const all: RepoPlugin[] = []
      for (const repo of repos) {
        if (!repo.trim()) continue
        all.push(...(await fetchRepoIndex(provider, repo.trim())))
      }
      setPlugins(all)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function install(p: RepoPlugin) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await runtime.installExternal({ id: p.id, version: p.version, url: p.url, sha256: p.sha256, manifestUrl: p.manifestUrl })
      setMessage(`Installed ${p.name} ${p.version}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="view">
      <h1>Plugins</h1>
      <div className="row wrap">
        <input placeholder="Add repo URL (e.g. https://host/plugins)" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} />
        <button
          onClick={() => {
            const v = repoInput.trim()
            if (v && !repos.includes(v)) setRepos((r) => [...r, v])
            setRepoInput('')
          }}
        >
          Add repo
        </button>
        <button onClick={refresh} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="repos">
        {repos.map((r) => (
          <span key={r} className="chip">
            {r}
            <button onClick={() => setRepos((list) => list.filter((x) => x !== r))}>×</button>
          </span>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="ok">{message}</div>}

      <h2>Available</h2>
      {plugins.length === 0 && <p className="muted">{busy ? 'Loading…' : 'No plugins found in configured repos.'}</p>}
      <div className="plugin-list">
        {plugins.map((p) => {
          const installedVer = runtime.installed.get(p.id)
          return (
            <div key={p.id} className="plugin-row">
              {p.iconUrl ? <img className="plugin-icon" src={p.iconUrl} alt="" /> : <div className="plugin-icon placeholder" />}
              <div className="grow">
                <div>
                  <strong>{p.name}</strong> <span className="muted">v{p.version}</span>
                  {p.lang ? ` · ${p.lang}` : ''}
                </div>
                <div className="muted small">
                  {p.mediaTypes.join(', ')}
                  {p.nsfw ? ' · NSFW' : ''}
                </div>
                {p.description && <div className="small">{p.description}</div>}
              </div>
              {installedVer ? (
                <button disabled={installedVer === p.version}>{installedVer === p.version ? 'Installed' : `Update (${p.version})`}</button>
              ) : (
                <button onClick={() => install(p)} disabled={busy}>
                  Install
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
