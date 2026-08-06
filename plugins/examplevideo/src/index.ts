import type { PluginRegistration } from '@woyomi/core'
import { API_VERSION } from '@woyomi/core'
import { exampleVideoSource } from './examplevideo.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var __media_plugin_register: any
}

const registration: PluginRegistration = {
  manifest: {
    id: 'examplevideo',
    name: 'Example Video',
    version: '0.1.0',
    apiVersion: API_VERSION,
    lang: 'en',
    description: 'Demo video source exercising the stream-extractor interface',
    mediaTypes: ['anime', 'movie', 'series'],
    entry: 'examplevideo.plugin.js',
    sourceIds: ['examplevideo']
  },
  sources: [exampleVideoSource]
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.(registration)
