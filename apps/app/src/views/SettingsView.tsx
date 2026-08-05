import { useCallback, useEffect, useState } from 'react'
import type { AppRuntime } from '../runtime'
import { PluginSettings } from './PluginSettings'

export function SettingsView({ runtime }: { runtime: AppRuntime }) {
  const [plugins, setPlugins] = useState(runtime.registry.list())

  const refresh = useCallback(() => setPlugins(runtime.registry.list()), [runtime])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function exportJson() {
    const json = await runtime.store.exportJson()
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'media-platform-library.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importJson(file: File) {
    await runtime.store.importJson(await file.text())
  }

  return (
    <div className="view">
      <h1>Settings</h1>

      <h2>Plugins</h2>
      <div className="plugin-list">
        {plugins.map((p) => (
          <div key={p.registration.manifest.id} className="plugin-row">
            <div className="grow">
              <div>
                <strong>{p.registration.manifest.name}</strong> <span className="muted">v{p.registration.manifest.version}</span> · {p.origin}
              </div>
              <div className="muted small">{p.registration.manifest.description ?? ''}</div>
              {p.registration.sources.length > 1 && (
                <div className="source-toggles">
                  {p.registration.sources.map((s) => (
                    <label key={s.id} className="multi-opt">
                      <input
                        type="checkbox"
                        checked={runtime.registry.isSourceEnabled(s.id)}
                        onChange={(e) => {
                          runtime.setSourceEnabled(p.registration.manifest.id, s.id, e.target.checked)
                          refresh()
                        }}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { runtime.registry.setEnabled(p.registration.manifest.id, !p.enabled); refresh(); }}>{p.enabled ? 'Disable' : 'Enable'}</button>
            {p.origin === 'external' && (
              <button
                className="danger"
                onClick={() => {
                  runtime.uninstall(p.registration.manifest.id)
                  refresh()
                }}
              >
                Uninstall
              </button>
            )}
          </div>
        ))}
      </div>

      <h2>Source settings</h2>
      {plugins.every((p) => !p.registration.manifest.prefs?.length) ? (
        <p className="muted">No configurable settings exposed by installed plugins.</p>
      ) : (
        <div className="plugin-list">
          {plugins.map((p) =>
            p.registration.manifest.prefs?.length ? (
              <div key={p.registration.manifest.id} className="plugin-row">
                <div className="grow">
                  <div>
                    <strong>{p.registration.manifest.name}</strong>
                  </div>
                  <PluginSettings runtime={runtime} pluginId={p.registration.manifest.id} />
                </div>
              </div>
            ) : null
          )}
        </div>
      )}

      <h2>Data</h2>
      <div className="row wrap">
        <button onClick={exportJson}>Export library</button>
        <label className="file-label">
          Import library
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
      </div>
    </div>
  )
}
