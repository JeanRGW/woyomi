import { useCallback, useEffect, useState } from 'react'
import type { AppRuntime } from '../runtime'
import { navigate } from '../App'
import { Btn, Page, SectionHeading, Toggle } from '../components'
import { Icon } from '../icons'

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
                runtime.registry.setEnabled(p.registration.manifest.id, !p.enabled)
                refresh()
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
