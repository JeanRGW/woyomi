# Media Platform

A multi-source content aggregator in the style of
[Aniyomi](https://github.com/aniyomiorg/aniyomi) / [Mihon](https://github.com/mihonapp/mihon),
built as a **Tauri 2 desktop + Android app** with a modular TypeScript plugin
system. Supports manga, anime, webnovels, movies, and series from pluggable
sources, with a local library, episode/chapter tracking, a paged manga reader,
a text novel reader, and an HLS/MP4 player.

## Architecture

```
apps/app            React 18 + Vite frontend AND Tauri 2 (Rust) shell
apps/server         optional self-hosted backend (web-mode scrape proxy + sync + plugin repo)
packages/core       plugin API, engine (runner), registry, loader, stores, zod protocol
packages/plugin-builder   CLI: plugin folder -> IIFE bundle + manifest + sha256; repo index generator
plugins/mangadex    first-party MangaDex source (manga + novel)
plugins/examplevideo      demo video source exercising the stream-extractor API
```

### The core idea: plugins are transport-agnostic TS modules

A plugin never calls `fetch` itself. It receives a `SourceContext` whose
`fetch` is injected by the app:

- **native (Tauri):** routes to a Rust `fetch_url` command (reqwest). No CORS
  — source sites are reachable directly.
- **browser/web mode:** uses the optional self-hosted `/api/scrape` proxy.

Plugins are bundled into self-contained IIFEs by `plugin-builder` and either
ship with the app (bundled) or are installed from remote repositories
(external), verified by sha256 and gated by `apiVersion`.

```
plugins/mangadex/src/index.ts
  └─ globalThis.__media_plugin_register({ manifest, sources })
       └─ esbuild bundle -> dist/mangadex.plugin.js (+ .plugin.json + sha256)
            └─ loaded at runtime by packages/core (loadBundle) into the registry + engine
```

### Plugin repositories (Mihon/Aniyomi-style providers)

Any static host (or the bundled `apps/server`) can serve a repo:

```
<repo>/
  index.json        # [{ id, name, version, apiVersion, mediaTypes, file, sha256, ... }]
  <id>.plugin.js    # the bundle
  <id>.plugin.json  # sidecar manifest
```

`index.json` is generated with `pnpm --filter @media-platform/plugin-builder exec node dist/gen-repo.js <distDir>`.
The app's Plugins screen manages repo URLs, lists available plugins, and
installs/updates/uninstalls them (sha256-verified, `apiVersion`-gated).

## Getting started

Requires **Node >= 22, pnpm 9/10/11**, and for the desktop app: **Rust
toolchain** (1.77+).

```sh
pnpm install            # install all workspace deps (approve esbuild build script)
pnpm build              # type-build all packages
pnpm test               # run all unit tests (Vitest, fixture-based, no network)
pnpm typecheck          # strict TS across all packages
```

### Desktop app (Tauri) — Windows / Linux / Android

```sh
pnpm --filter @media-platform/app build:plugin-mangadex   # build first-party plugins (see note)
pnpm --filter @media-platform/app tauri dev                # run in dev shell (requires Rust)
pnpm --filter @media-platform/app tauri build              # release bundle
```

Android: add the platform with `cargo tauri android init`, then
`cargo tauri android dev`.

### Web build (no native shell)

The same React codebase runs in a plain browser (dev server) for quick UI
iteration — scraping falls back to direct `fetch` (works for CORS-enabled APIs
like MangaDex) or the self-hosted proxy.

```sh
pnpm --filter @media-platform/app dev     # http://localhost:1420
```

### Self-hosted backend (optional)

Web-mode scrape proxy + library sync + plugin repo:

```sh
cd apps/server
SYNC_TOKEN=changeme DATA_DIR=./data PORT=8787 pnpm dev
curl http://localhost:8787/health
# plugin repo lives at http://localhost:8787/repo (used by the app's Plugins screen)
```

Environment: `SYNC_TOKEN` (Bearer token for `/api/sync/*`), `DATA_DIR`
(default `./data`), `PORT` (default `8787`). Bootstraps with `@hono/node-server`.

## Writing a plugin

1. `mkdir plugins/mysource` with a `package.json` depending on
   `@media-platform/core`.
2. Implement a `Source` (see `packages/core/src/types.ts`) and register it in
   `src/index.ts` via `__media_plugin_register`.
3. Build: `pnpm --filter @media-platform/plugin-builder exec node dist/cli.js plugins/mysource plugins/mysource/dist`
4. Distribute via a repo `index.json` (see `gen-repo.js`) or bundle into the app.

The `Source` interface (one unified model across all five media types):

```ts
interface Source {
  id: string; name: string; mediaTypes: MediaType[]
  search(ctx, query, page): Promise<SearchResults>
  getMedia(ctx, id): Promise<Media>
  getEpisodes(ctx, mediaId): Promise<Episode[]>      // chapters/episodes/seasons unified
  getChapterContent(ctx, mediaId, epId): Promise<ChapterContent>  // {type:'pages'|'text'}
  getStreams?(ctx, media, episode): Promise<StreamSource[]>        // video only
}
```

## Testing

- **Unit tests (Vitest):** core engine/registry/loader/store, plugin parsers
  against JSON/HTML fixtures, builder round-trip + repo generation, server
  API. Run with `pnpm test` — no network required.
- **Live smoke test:** `node --input-type=module scripts/smoke.mjs` exercises
  the full MangaDex pipeline (search → media → episodes → chapter pages)
  against the real API.

## Status / known limits

- Plugins execute inside a per-plugin **Web Worker sandbox** (no `window`, no
  Tauri IPC, no DOM access); their `SourceContext` (`fetch`/`cache`/
  `preferences`) is served over a `postMessage` RPC bridge, and an HTML
  `DOMParser` (linkedom) is injected so scraping plugins work. The sync
  `loadBundle` in `loader.ts` is used only by `plugin-builder` for build-time
  manifest capture.
- The video source is a demo (`examplevideo`) returning a public HLS test
  stream; wiring real extractors is plugin work, isolated behind
  `getStreams()`.
- Linux WebKitGTK's MSE support is incomplete for some HLS streams; the
  fallback path (native mpv/ExoPlayer) is a future phase.
- `mode:'dom'` fetches (headless page rendering for JS-heavy sites) are stubbed
  in the Rust command and unsupported in browser mode.
- DRM (Widevine) streams are not supported.
