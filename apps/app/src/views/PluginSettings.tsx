import { useEffect, useState } from 'react'
import type { PreferenceValue, SourcePref } from '@woyomi/core'
import type { AppRuntime } from '../runtime'
import { SelectInput, TextInput, Toggle } from '../components'

/** Renders one plugin's declared prefs, bound to the engine's prefs backend. */
export function PluginSettings({ runtime, pluginId }: { runtime: AppRuntime; pluginId: string }) {
  return (
    <div className="flex flex-col">
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
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="flex min-w-40 flex-col gap-0.5">
        <strong className="text-sm font-semibold">{pref.label}</strong>
        {pref.description && <span className="text-xs text-muted">{pref.description}</span>}
      </span>
      {pref.type === 'boolean' ? (
        <Toggle checked={value === true} onChange={update} label={pref.label} />
      ) : pref.type === 'select' ? (
        <SelectInput value={String(value ?? '')} onChange={(e) => update(e.target.value)}>
          {(pref.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectInput>
      ) : pref.type === 'multi' ? (
        <span className="flex max-w-72 flex-wrap justify-end gap-x-3 gap-y-1.5">
          {(pref.options ?? []).map((o) => {
            const current = Array.isArray(value) ? value : []
            const checked = current.includes(o.value)
            return (
              <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => update(checked ? current.filter((v) => v !== o.value) : [...current, o.value])}
                  className="size-4 accent-accent"
                />
                {o.label}
              </label>
            )
          })}
        </span>
      ) : (
        <TextInput className="max-w-56 flex-none" value={String(value ?? '')} onChange={(e) => update(e.target.value)} />
      )}
    </div>
  )
}
