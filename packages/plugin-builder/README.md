# @woyomi/plugin-builder

Build tooling for [woyomi](https://woyomi.rgw.app) media plugins: bundles a
plugin folder into a self-contained IIFE with a sidecar manifest and sha256,
and generates Mihon/Aniyomi-style repository indexes.

## Install

```sh
npm install @woyomi/plugin-builder
# or: pnpm add @woyomi/plugin-builder
```

Requires Node >= 20. ESM only (`"type": "module"`).

## CLI

```sh
woyomi-plugin-build <pluginRoot> <outDir>
```

- `<pluginRoot>` — plugin package root (contains `package.json` + `src/index.ts`)
- `<outDir>` — output directory (default `dist`)

`media-plugin-build` is kept as an alias for existing setups.

Outputs:

```
<outDir>/
  <id>.plugin.js     # self-contained IIFE bundle
  <id>.plugin.json   # sidecar manifest (version, apiVersion, sha256, …)
  index.json         # repo index generated from the manifests in <outDir>
```

The bundle is evaluated once at build time to capture and validate its
registration: it must call `globalThis.__media_plugin_register` exactly once,
and its `manifest.apiVersion` must equal `API_VERSION` from `@woyomi/core`.

Typical plugin `package.json` script:

```json
{
  "scripts": {
    "build": "woyomi-plugin-build . dist"
  }
}
```

## Library API

```ts
import { buildPlugin, generateRepoIndex } from '@woyomi/plugin-builder'

const { pluginJs, manifest, sha256 } = await buildPlugin({
  root: 'plugins/mysource',   // plugin package root
  outDir: 'plugins/mysource/dist'
  // version: '1.0.0',        // optional, overrides package.json version
  // entry: 'src/index.ts',   // optional, defaults to <root>/src/index.ts
})

await generateRepoIndex('plugins/mysource/dist')
```

Subpath exports `@woyomi/plugin-builder/build` and
`@woyomi/plugin-builder/gen-repo` expose the same functions individually.

## Repository index

`generateRepoIndex(dir)` scans `*.plugin.json` files and writes an
`index.json` consumable by the woyomi app's Plugins screen:

```json
{
  "name": "woyomi Repo",
  "plugins": [
    { "id": "…", "name": "…", "version": "…", "apiVersion": 1,
      "mediaTypes": ["manga"], "file": "<id>.plugin.js", "sha256": "…" }
  ]
}
```

Serve `index.json` and the plugin files from the same directory (any static
host, or the bundled `apps/server`).

## License

[Apache-2.0](./LICENSE) © JeanRGW
