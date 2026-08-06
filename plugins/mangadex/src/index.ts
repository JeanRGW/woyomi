import type { PluginRegistration } from '@woyomi/core'
import { API_VERSION } from '@woyomi/core'
import { makeMangadexSource, type MangadexLangDef } from './mangadex.js'

declare global {
  interface Window {
    __media_plugin_register?: (registration: PluginRegistration) => void
  }
  // Some bundlers type globalThis as Window only; keep an escape hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var __media_plugin_register: any
}

const LANGS: MangadexLangDef[] = [
  { code: 'en', label: 'EN' },
  { code: 'pt-br', label: 'PT-BR' },
  { code: 'es', label: 'ES' },
  { code: 'es-la', label: 'ES-LA' },
  { code: 'fr', label: 'FR' },
  { code: 'de', label: 'DE' },
  { code: 'it', label: 'IT' },
  { code: 'ru', label: 'RU' },
  { code: 'ja', label: 'JA' },
  { code: 'ko', label: 'KO' },
  { code: 'zh', label: 'ZH' },
  { code: 'zh-hk', label: 'ZH-HK' },
  { code: 'id', label: 'ID' },
  { code: 'tr', label: 'TR' }
]

const sources = LANGS.map(makeMangadexSource)

const registration: PluginRegistration = {
  manifest: {
    id: 'mangadex',
    name: 'MangaDex',
    version: '0.1.0',
    apiVersion: API_VERSION,
    lang: 'en',
    description: 'MangaDex — manga & light-novel source (one source per language)',
    mediaTypes: ['manga', 'novel'],
    entry: 'mangadex.plugin.js',
    sourceIds: sources.map((s) => s.id),
    prefs: [
      {
        key: 'dataSaver',
        label: 'Use data-saver images',
        type: 'boolean',
        defaultValue: true,
        description: 'Smaller, lower-quality images (MangaDex data-saver)'
      }
    ]
  },
  sources
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.(registration)
