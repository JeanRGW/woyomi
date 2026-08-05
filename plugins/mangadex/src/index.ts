import type { PluginRegistration } from '@media-platform/core'
import { API_VERSION } from '@media-platform/core'
import { mangaDexSource } from './mangadex.js'

declare global {
  interface Window {
    __media_plugin_register?: (registration: PluginRegistration) => void
  }
  // Some bundlers type globalThis as Window only; keep an escape hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var __media_plugin_register: any
}

const registration: PluginRegistration = {
  manifest: {
    id: 'mangadex',
    name: 'MangaDex',
    version: '0.1.0',
    apiVersion: API_VERSION,
    lang: 'en',
    description: 'MangaDex — manga & light-novel source',
    mediaTypes: ['manga', 'novel'],
    entry: 'mangadex.plugin.js',
    sourceIds: ['mangadex'],
    prefs: [
      {
        key: 'lang',
        label: 'Language',
        type: 'select',
        defaultValue: 'en',
        description: 'Translated chapters language filter',
        options: [
          { value: 'en', label: 'English' },
          { value: 'fr', label: 'French' },
          { value: 'de', label: 'German' },
          { value: 'es', label: 'Spanish' },
          { value: 'pt-br', label: 'Portuguese (BR)' },
          { value: 'ja', label: 'Japanese' },
          { value: 'ko', label: 'Korean' },
          { value: 'zh', label: 'Chinese' }
        ]
      },
      {
        key: 'dataSaver',
        label: 'Use data-saver images',
        type: 'boolean',
        defaultValue: true,
        description: 'Smaller, lower-quality images (MangaDex data-saver)'
      }
    ]
  },
  sources: [mangaDexSource]
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.(registration)
