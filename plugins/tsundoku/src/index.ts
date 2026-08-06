import type { PluginRegistration } from '@media-platform/core'
import { API_VERSION } from '@media-platform/core'
import { makeTsundokuSource } from './tsundoku.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var __media_plugin_register: any
}

const registration: PluginRegistration = {
  manifest: {
    id: 'tsundoku',
    name: 'Tsundoku Traduções',
    version: '0.1.0',
    apiVersion: API_VERSION,
    lang: 'pt-br',
    description: 'Tsundoku Traduções — mangás, manhuas, manhwas e light novels (HTML scraping)',
    mediaTypes: ['manga', 'novel'],
    entry: 'tsundoku.plugin.js',
    sourceIds: ['tsundoku']
  },
  sources: [makeTsundokuSource()]
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.(registration)