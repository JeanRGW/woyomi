# Changelog

All notable changes to this package are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-14

### Added

- Initial public release: plugin type model (`Source`, `Media`, `Episode`,
  `ChapterContent`, `StreamSource`), zod protocol schemas, `API_VERSION`
  gating, `Engine`, `PluginRegistry`, `loadBundle`, per-plugin Web Worker
  sandbox (`loadPluginSandbox` / `runPluginWorkerHost`), memory and IndexedDB
  stores, `fetchJson`/`fetchHtml` helpers, `TTLCache`, and `sha256Hex`.

## [0.4.0] - 2026-09-09

### Added

- `dash` variant on `StreamKind` and protocol schema for MPEG-DASH manifests
  (e.g. AnimeFire via akumast.net). Hosts play them with MSE (dash.js,
  lazy-loaded) on desktop and ExoPlayer natively on Android. Downloads stay
  MP4-only, same as HLS. Additive: existing plugins are unaffected.
- Optional `audio` on `StreamSource` (+ protocol schema) for sources that
  deliver each audio version as its own stream (e.g. AnimeFire/SubAnimes
  `Dublado`/`Legendado`). Hosts can offer an audio menu and persist the
  preference instead of guessing from the `quality` label. Additive: sources
  without `audio` keep today's behavior.

## [0.3.0] - 2026-08-22

### Added

- Optional `coverHeaders` on `Media` interface and protocol schema. Hosts route
  cover images through the local stream proxy so sources with Referer/header-gated
  CDNs display covers without hotlink blocks. Additive: existing plugins are
  unaffected.

## [0.2.0] - 2026-08-16

### Added

- Optional `headers` on the `pages` variant of `ChapterContent` (type +
  protocol schema). Hosts apply them when fetching page images so sources
  behind Referer-gated CDNs can be read. Additive: existing plugins are
  unaffected.

[0.4.0]: https://github.com/JeanRGW/woyomi/compare/packages-v0.3.0...packages-v0.4.0

[0.3.0]: https://github.com/JeanRGW/woyomi/compare/packages-v0.2.0...packages-v0.3.0

[0.2.0]: https://github.com/JeanRGW/woyomi/compare/packages-v0.1.0...packages-v0.2.0

[0.1.0]: https://github.com/JeanRGW/woyomi/releases/tag/packages-v0.1.0
