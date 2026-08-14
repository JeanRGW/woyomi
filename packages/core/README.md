# @woyomi/core

Core library of the [woyomi](https://woyomi.rgw.app) multi-source media
aggregator (Aniyomi/Mihon-style): the plugin API, the source engine, the
plugin registry/loader, the Web Worker plugin sandbox, zod wire-protocol
schemas, and storage adapters.

Plugins written against this package are transport-agnostic TypeScript
modules — they never call `fetch` directly; everything network-y is injected
through a `SourceContext`.

## Install

```sh
npm install @woyomi/core
# or: pnpm add @woyomi/core
```

Requires Node >= 20 (or any modern browser). ESM only (`"type": "module"`).

## What's inside

| Export | Purpose |
| --- | --- |
| `Source`, `Media`, `Episode`, `ChapterContent`, `StreamSource`, … | The unified plugin type model (manga, anime, novel, movie, series) |
| `PluginManifestSchema`, `*Schema` (zod) | Wire-protocol validation for manifests and payloads |
| `API_VERSION` | The plugin API version a bundle must target |
| `validateManifest` | Manifest validation used at build time and load time |
| `Engine`, `ThrottledFetch` | Runtime that drives registered sources (search, media, episodes, content, streams) |
| `PluginRegistry` | Register bundled/external plugins, enable/disable plugins and individual sources |
| `loadBundle` | Build-time bundle evaluator (captures the registration) |
| `loadPluginSandbox`, `runPluginWorkerHost` | Per-plugin Web Worker sandbox + host (postMessage RPC) |
| `MemoryStore`, `IndexedDbStore`, … | Library/progress/history/plugin/preferences stores |
| `fetchJson`, `fetchHtml` | Thin helpers over the injected `ctx.fetch` |
| `TTLCache`, `sha256Hex` | Small utilities |

## Writing a plugin

```ts
import type { PluginRegistration, Source } from '@woyomi/core'
import { API_VERSION } from '@woyomi/core'

const source: Source = {
  id: 'mysource',
  name: 'My Source',
  mediaTypes: ['manga'],
  async search(ctx, query, page) {
    const html = await fetchHtml(ctx.fetch, `https://example.com/?q=${query}&p=${page}`)
    // parse + map to Media[]
    return { page, hasNextPage: false, items: [] }
  },
  async getMedia(ctx, id) { /* … */ },
  async getEpisodes(ctx, mediaId) { /* … */ },
  async getChapterContent(ctx, mediaId, epId) { /* … */ }
}

const registration: PluginRegistration = {
  manifest: {
    id: 'mysource',
    name: 'My Source',
    version: '0.1.0',
    apiVersion: API_VERSION,
    mediaTypes: ['manga'],
    entry: 'mysource.plugin.js',
    sourceIds: [source.id]
  },
  sources: [source]
}

;(globalThis as Record<string, unknown>).__media_plugin_register?.(registration)
```

Bundle it with [`@woyomi/plugin-builder`](https://www.npmjs.com/package/@woyomi/plugin-builder)
into a self-contained IIFE and distribute it through a plugin repository.

## Compatibility

`manifest.apiVersion` must equal `API_VERSION` — the builder and the runtime
enforce this, so plugins and apps cannot silently drift apart.

## License

[Apache-2.0](./LICENSE) © JeanRGW
