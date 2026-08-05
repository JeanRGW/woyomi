import { useCallback, useEffect, useState } from 'react'
import type { AppRuntime } from '../runtime'
import { navigate } from '../App'
import { EmptyState, Page } from '../components'
import { PluginSettings } from './PluginSettings'
import { Icon } from '../icons'

/** Dedicated page holding every installed plugin's settings: source toggles + declared prefs. */
export function PluginSettingsView({ runtime }: { runtime: AppRuntime }) {
  const [plugins, setPlugins] = useState(runtime.registry.list())

  const refresh = useCallback(() => setPlugins(runtime.registry.list()), [runtime])
  useEffect(() => {
    refresh()
  }, [refresh])

  const configurable = plugins.filter((p) => (p.registration.manifest.prefs?.length ?? 0) > 0 || p.registration.sources.length > 1)

  return (
    <Page>
      <button
        onClick={() => navigate({ name: 'settings' })}
        className="mb-4 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-surface/80 px-3.5 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Icon name="back" size={17} />
        Settings
      </button>
      <div className="mb-5 md:mb-7">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Plugin settings</h1>
        <p className="mt-1 text-sm text-muted">Every option exposed by your installed plugins, in one place.</p>
      </div>

      {configurable.length === 0 ? (
        <EmptyState icon="sliders" title="Nothing to configure" hint="Installed plugins do not expose any settings yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {configurable.map((p) => (
            <section key={p.registration.manifest.id} className="rounded-2xl border border-line-soft bg-surface p-4 md:p-5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h2 className="text-base font-bold">{p.registration.manifest.name}</h2>
                <span className="text-xs text-faint">
                  v{p.registration.manifest.version} · {p.origin}
                </span>
              </div>
              {p.registration.manifest.description && <p className="mt-0.5 text-xs text-muted">{p.registration.manifest.description}</p>}

              {p.registration.sources.length > 1 && (
                <div className="mt-3 border-t border-line-soft pt-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Sources</div>
                  <div className="flex flex-wrap gap-2">
                    {p.registration.sources.map((s) => {
                      const enabled = runtime.registry.isSourceEnabled(s.id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => {
                            runtime.setSourceEnabled(p.registration.manifest.id, s.id, !enabled)
                            refresh()
                          }}
                          className={`min-h-9 cursor-pointer rounded-full px-3.5 text-[13px] font-semibold transition-all active:scale-[0.96] ${
                            enabled ? 'bg-accent text-white shadow-sm shadow-accent/25' : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg'
                          }`}
                        >
                          {s.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {(p.registration.manifest.prefs?.length ?? 0) > 0 && (
                <div className="mt-3 border-t border-line-soft pt-3">
                  <PluginSettings runtime={runtime} pluginId={p.registration.manifest.id} />
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
