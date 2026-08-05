import type { PluginManifest, PluginRegistration, Source } from './types.js'
import { PluginManifestSchema } from './protocol.js'
import { API_VERSION } from './version.js'

export interface LoadedPlugin {
  registration: PluginRegistration
  /** 'bundled' plugins ship with the app and update with it; 'external' are user-installed */
  origin: 'bundled' | 'external'
  enabled: boolean
}

export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>()
  private disabledSources = new Set<string>()

  /** Register a statically-imported plugin (ships with the app). */
  registerBundled(registration: PluginRegistration): void {
    this.put(registration, 'bundled')
  }

  /** Register a plugin whose manifest was already validated and apiVersion-gated. */
  registerExternal(registration: PluginRegistration): void {
    this.put(registration, 'external')
  }

  private put(registration: PluginRegistration, origin: 'bundled' | 'external') {
    if (registration.manifest.apiVersion !== API_VERSION) {
      throw new Error(
        `plugin "${registration.manifest.name}" requires apiVersion ${registration.manifest.apiVersion}, runtime is ${API_VERSION}`
      )
    }
    this.plugins.set(registration.manifest.id, { registration, origin, enabled: true })
  }

  unregister(pluginId: string): void {
    this.plugins.delete(pluginId)
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginId)
    if (plugin) plugin.enabled = enabled
  }

  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.enabled ?? false
  }

  /** Enable/disable a single source inside a plugin (e.g. per-language sources). */
  setSourceEnabled(sourceId: string, enabled: boolean): void {
    if (enabled) this.disabledSources.delete(sourceId)
    else this.disabledSources.add(sourceId)
  }

  isSourceEnabled(sourceId: string): boolean {
    return !this.disabledSources.has(sourceId)
  }

  list(): LoadedPlugin[] {
    return [...this.plugins.values()]
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId)
  }

  sources(): Source[] {
    const out: Source[] = []
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled) continue
      for (const source of plugin.registration.sources) {
        if (this.disabledSources.has(source.id)) continue
        out.push(source)
      }
    }
    return out
  }
}

export function validateManifest(raw: unknown): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`invalid plugin manifest: ${parsed.error.message}`)
  return parsed.data
}
