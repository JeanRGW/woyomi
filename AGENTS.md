# AGENTS.md

pnpm workspaces + turbo monorepo: a Tauri desktop app and modular TS plugin
system (Aniyomi/Mihon-style). See `README.md` for the full architecture.

## Commands

Requires Node >= 22, pnpm 11.8.0 (pinned in `package.json` + CI).

```sh
pnpm install                # esbuild build script is pre-approved (pnpm-workspace.yaml)
pnpm build                  # turbo: build all packages to dist
pnpm test                   # Vitest across all packages (fixtures inline, no network)
pnpm typecheck              # strict TS, all packages
pnpm --filter @woyomi/app lint    # only lint target in the repo (eslint)
pnpm dev                    # app Vite dev server, http://localhost:1420
pnpm smoke                  # offline fixture-plugin pipeline test (needs pnpm build first)
```

Turbo orders `test` and `typecheck` after `build` automatically.

### Ordering gotcha (easy to miss)

`dist/`, `*.plugin.js`, `*.plugin.json` are gitignored. Packages import each
other via built `dist/` outputs — so **`pnpm build` must run before `pnpm dev` /
app `vite build` / `pnpm smoke`**.

### Server (optional self-hosted backend)

```sh
cd apps/server
SYNC_TOKEN=replace-with-a-long-random-token DATA_DIR=./data PORT=8787 pnpm dev
```

Hono app: `/api/scrape` CORS proxy (off by default; `SCRAPE_ENABLED=true`
+ optional `SCRAPE_TOKEN`), `/api/sync/:user` JSON sync, `/repo`
aggregates plugin dist dirs found under `PLUGIN_REPO_DIR` (default: repo
root `plugins/*/dist`; an empty dir serves an empty index).

### Plugin tooling

```sh
# build one plugin -> IIFE + sidecar manifest + sha256 in <outDir>
pnpm --filter @woyomi/plugin-builder exec node dist/cli.js <pluginRoot> <outDir>
# generate a Mihon-style repo index.json from built artifacts
pnpm --filter @woyomi/plugin-builder exec node dist/gen-repo.js <distDir>
```

## Architecture

- `packages/core` — plugin API (`Source` types, zod `protocol`), `Engine`
  (runner), `PluginRegistry`, loader + **Web Worker sandbox** (`sandbox.ts`
  / `sandbox-worker-host.ts`), stores (Memory/IndexedDb), sha256.
  Exports via `dist/index.js`; source uses `.js` extension on relative imports.
- `packages/plugin-builder` — esbuild bundler (IIFE, browser platform) + repo
  index generator. Bin is `woyomi-plugin-build` (alias `media-plugin-build`)
  — plugins' `build` script.
- No bundled sources: the app ships with zero plugins; users install them
  from external plugin repos (see `installExternal` in runtime.ts,
  `StoreView.tsx`, `provider.ts`, and the server `/repo` endpoint, which
  aggregates `<repoRoot>/plugins/*/dist`). `scripts/fixture-plugin` is a
  minimal reference plugin used by `pnpm smoke`.
- `apps/app` — React 18 + Vite frontend and the Tauri 2 Rust shell
  (`src-tauri/`). `src/runtime.ts` wires fetch/stores per runtime. Native
  offline downloads live in `src/downloads.ts` (`DownloadManager`, foreground
  queue) + a `downloads` SQLite table, backed by Rust `download_*` commands and
  a loopback `/offline/<fileId>/<index>` Range server (see `src-tauri/src/lib.rs`).
- `apps/server` — optional Hono backend.

### Plugin contract (enforced at build + load time)

- Plugins **never call `fetch`** directly; they use the injected
  `ctx.fetch` (or `fetchJson`/`fetchHtml` helpers) which routes to the Rust
  `fetch_url` command in Tauri, direct `fetch` in browser (CORS-limited), or
  the self-hosted `/api/scrape` proxy.
- A bundle is a self-contained IIFE calling
  `globalThis.__media_plugin_register({ manifest, sources })` exactly once.
- Sources that serve covers/page images behind hotlink protection (e.g. a
  Cloudflare `Referer`) declare the required headers via `Media.coverHeaders`
  and the pages variant's `ChapterContent.headers`. The app routes those
  images through the localhost stream proxy (native) or the web `/api/stream`
  endpoint when a web proxy is configured, falling back to the raw URL
  otherwise (a browser `<img>` can't send headers).
- `manifest.apiVersion` must equal `API_VERSION` from core (checked by the
  builder and by `installExternal` in runtime.ts, which also verifies sha256).
- Plugins execute inside a per-plugin Web Worker sandbox (packages/core
  `sandbox.ts` / `sandbox-worker-host.ts`); `loadBundle` in `loader.ts` is used
  only by `plugin-builder` for build-time manifest capture.

### i18n (UI text) — mandatory for the app

All user-facing UI strings in `apps/app` MUST go through the i18n catalog —
**no hardcoded text in components**. Add or change a string by editing the
catalog, never by inlining text in JSX/aria/placeholders.

- Catalogs: `apps/app/src/i18n/messages.ts` (`en` defines the canonical key
  set), `apps/app/src/i18n/pt.ts` (pt-BR). `LocaleId` = the locale keys;
  `Messages = Record<MessageKey, string>` is the shape every locale must
  satisfy, so `typecheck` enforces full coverage — a new key added to `en`
  without a translation breaks the build.
- Usage: `const t = useT()` (or `useI18n()` for `locale`/`setLocale`), then
  `t('view.key')`, `t('view.key', { name })` for interpolation, and
  `t('view.key', { count })` to select the `key.one` plural form when
  `count === 1` (base key is the plural/"other" form).
- Key conventions: flat keys prefix-grouped by view (`nav.*`, `browse.*`,
  `reader.*`, `status.*`, `type.*` …). Media-type-aware labels (reading vs
  watching) are picked via helpers like `libraryStatusLabelKey`.
- Adding a locale: create a `Messages`-typed catalog, add it to `messages`,
  extend `localeNameKey`, and add a `settings.lang.<id>` self-name key to
  every catalog. The Settings language selector lists locales automatically.
- Not translated (by design): plugin-provided content (source names,
  descriptions, prefs) and diagnostic error messages thrown by
  `runtime.ts`/`provider.ts`/`sync.ts`/`scrape.ts`.

## Quirks / gotchas

- Strict TS via `tsconfig.base.json`: `verbatimModuleSyntax` (must write
  `import type`), `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`.
- `mode:'dom'` fetches are stubbed in the Rust command and unsupported in
  browser mode.
- **Downloads are native-only** (Tauri). `runtime.downloads` is undefined in
  the browser build; UI gates on it. The `downloads` table is separate from
  sync — never fold download metadata into `LibraryStore`/`SyncPayload`.
- Test fixtures are inline objects in the test files (no `fixtures/` dir).
- `apps/server/data/` (runtime data) and `.commandcode/` are not committed.

## Style

- Use descriptive variable names; extract complex conditions into named
  boolean variables. Follow existing patterns; reuse helpers before adding deps.
