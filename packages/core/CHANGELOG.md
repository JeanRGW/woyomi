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

[0.1.0]: https://github.com/JeanRGW/woyomi/releases/tag/packages-v0.1.0
