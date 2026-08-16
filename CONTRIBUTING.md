# Contributing to woyomi

Thanks for your interest in contributing!

## Getting started

```sh
git clone <your-fork-url>
cd woyomi
pnpm install        # Node >= 22, pnpm 11.8.0 (pinned via packageManager)
pnpm build          # required before dev/test/smoke (packages import dist outputs)
pnpm test
pnpm typecheck
```

Run the app in dev mode with `pnpm dev` (Vite, http://localhost:1420) or
`pnpm --filter @woyomi/app tauri dev` (requires the Rust toolchain).

## Ground rules

- **No content, no sources.** woyomi ships zero sources/plugins and hosts no
  content. Do not open PRs that add source plugins for specific sites to this
  repository — plugins are developed and distributed in separate,
  community-run repositories. The plugin SDK and tooling live here.
- All user-facing UI strings in `apps/app` must go through the i18n catalog
  (`apps/app/src/i18n/`); never hardcode text in components. New keys must be
  added to every locale catalog (`en`, `pt`) or typecheck fails.
- Strict TypeScript (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`,
  `noUnusedLocals/Parameters`). Use `import type` for type-only imports.
- Tests are Vitest with inline fixtures — no network access in unit tests.

## Before opening a PR

1. `pnpm build && pnpm typecheck && pnpm test` must pass
   (`pnpm --filter @woyomi/app lint` if you touched the app).
2. Keep changes focused; one logical change per PR.
3. Follow the existing code style — descriptive names, named boolean
   conditions for complex logic, reuse existing helpers before adding
   dependencies.

## Reporting bugs

Open an issue with your OS, app version (desktop/Android/web), and steps to
reproduce. For crashes, include console output. Plugin-specific problems
(source sites failing) belong in the plugin's own repository, not here.

## License

By contributing you agree that your contributions are licensed under the
Apache-2.0 license (see `LICENSE`).
