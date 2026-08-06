# AGENTS.md

pnpm workspaces + turbo monorepo: a Tauri desktop app and modular TS plugin
system (Aniyomi/Mihon-style). See `README.md` for the full architecture.

## Commands

Requires Node >= 22, pnpm 11.8.0 (pinned in `package.json` + CI).

```sh
pnpm install                # esbuild build script is pre-approved (pnpm-workspace.yaml)
pnpm build                  # turbo: build all packages AND first-party plugin IIFEs to dist
pnpm test                   # Vitest across all packages (fixtures inline, no network)
pnpm typecheck              # strict TS, all packages
pnpm --filter @media-platform/app lint    # only lint target in the repo (eslint)
pnpm dev                    # app Vite dev server, http://localhost:1420
pnpm smoke                  # live MangaDex pipeline test (needs pnpm build first)
```

Turbo orders `test` and `typecheck` after `build` automatically.

### Ordering gotcha (easy to miss)

`dist/`, `*.plugin.js`, `*.plugin.json` are gitignored. `apps/app/src/runtime.ts`
loads bundled plugins via `?raw` imports of their built dist files (mangadex,
tsundoku, examplevideo) — so **`pnpm build` must run before `pnpm dev` /
app `vite build` / `pnpm smoke`**. `pnpm build` alone is sufficient (plugins
have a `build` script producing the IIFE bundles).

### Server (optional self-hosted backend)

```sh
cd apps/server
SYNC_TOKEN=changeme DATA_DIR=./data PORT=8787 pnpm dev
```

Hono app: `/api/scrape` CORS proxy (off by default; `SCRAPE_ENABLED=true`
+ optional `SCRAPE_TOKEN`), `/api/sync/:user` JSON sync, `/repo`
aggregates the built plugin dist dirs.

### Plugin tooling

```sh
# build one plugin -> IIFE + sidecar manifest + sha256 in <outDir>
pnpm --filter @media-platform/plugin-builder exec node dist/cli.js <pluginRoot> <outDir>
# generate a Mihon-style repo index.json from built artifacts
pnpm --filter @media-platform/plugin-builder exec node dist/gen-repo.js <distDir>
```

## Architecture

- `packages/core` — plugin API (`Source` types, zod `protocol`), `Engine`
  (runner), `PluginRegistry`, loader + **Web Worker sandbox** (`sandbox.ts`
  / `sandbox-worker-host.ts`), stores (Memory/IndexedDb), sha256.
  Exports via `dist/index.js`; source uses `.js` extension on relative imports.
- `packages/plugin-builder` — esbuild bundler (IIFE, browser platform) + repo
  index generator. Bin is `media-plugin-build` (plugins' `build` script).
- `plugins/*` — first-party sources (`mangadex`, `tsundoku`,
  `examplevideo`). They are **workspace packages that depend on
  `@media-platform/core`** and ship as bundled plugins via `?raw` imports.
- `apps/app` — React 18 + Vite frontend and the Tauri 2 Rust shell
  (`src-tauri/`). `src/runtime.ts` wires fetch/stores per runtime.
- `apps/server` — optional Hono backend.

### Plugin contract (enforced at build + load time)

- Plugins **never call `fetch`** directly; they use the injected
  `ctx.fetch` (or `fetchJson`/`fetchHtml` helpers) which routes to the Rust
  `fetch_url` command in Tauri, direct `fetch` in browser (CORS-limited), or
  the self-hosted `/api/scrape` proxy.
- A bundle is a self-contained IIFE calling
  `globalThis.__media_plugin_register({ manifest, sources })` exactly once.
- `manifest.apiVersion` must equal `API_VERSION` from core (checked by the
  builder and by `installExternal` in runtime.ts, which also verifies sha256).
- Plugins execute inside a per-plugin Web Worker sandbox (packages/core
  `sandbox.ts` / `sandbox-worker-host.ts`); `loadBundle` in `loader.ts` is used
  only by `plugin-builder` for build-time manifest capture.

## Quirks / gotchas

- Strict TS via `tsconfig.base.json`: `verbatimModuleSyntax` (must write
  `import type`), `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`.
- `mode:'dom'` fetches are stubbed in the Rust command and unsupported in
  browser mode.
- Test fixtures are inline objects in the test files (no `fixtures/` dir).
- `apps/server/data/` (runtime data) and `.commandcode/` are not committed.

## Style

- Use descriptive variable names; extract complex conditions into named
  boolean variables. Follow existing patterns; reuse helpers before adding deps.
