import type { PluginRegistration } from '@woyomi/core'
import { API_VERSION } from '@woyomi/core'
import { makeAnimefireSource } from './animefire.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var __media_plugin_register: any
}

const registration: PluginRegistration = {
  manifest: {
    id: 'animefire',
    name: 'AnimeFire',
    version: '0.1.0',
    apiVersion: API_VERSION,
    lang: 'pt-br',
    description: 'AnimeFire — animes legendados e dublados (HTML scraping)',
    mediaTypes: ['anime'],
    entry: 'animefire.plugin.js',
    sourceIds: ['animefire']
  },
  sources: [makeAnimefireSource()]
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.(registration)