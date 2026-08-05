import { useEffect, useState } from 'react'
import type { PreferenceValue, SourcePref } from '@media-platform/core'
import type { AppRuntime } from '../runtime'

/** Renders one plugin's declared prefs, bound to the engine's prefs backend. */
export function PluginSettings({ runtime, pluginId }: { runtime: AppRuntime; pluginId: string }) {
  return (
    <div>
      {runtime.registry.get(pluginId)?.registration.manifest.prefs?.map((pref) => (
        <PrefControl key={pref.key} runtime={runtime} pluginId={pluginId} pref={pref} />
      ))}
    </div>
  )
}

function PrefControl({ runtime, pluginId, pref }: { runtime: AppRuntime; pluginId: string; pref: SourcePref }) {
  const [value, setValue] = useState<PreferenceValue | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    runtime.engine.prefs.get(pluginId, pref.key).then((v) => {
      if (!cancelled) setValue(v ?? pref.defaultValue)
    })
    return () => {
      cancelled = true
    }
  }, [runtime, pluginId, pref])

  async function update(next: PreferenceValue) {
    setValue(next)
    await runtime.engine.prefs.set(pluginId, pref.key, next)
  }

  return (
    <label className="pref-row">
      <span>
        <strong>{pref.label}</strong>
        {pref.description && <span className="muted small">{pref.description}</span>}
      </span>
      {pref.type === 'boolean' ? (
        <input type="checkbox" checked={value === true} onChange={(e) => update(e.target.checked)} />
      ) : pref.type === 'select' ? (
        <select value={String(value ?? '')} onChange={(e) => update(e.target.value)}>
          {(pref.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input type="text" value={String(value ?? '')} onChange={(e) => update(e.target.value)} />
      )}
    </label>
  )
}
