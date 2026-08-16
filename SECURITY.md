# Security policy

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Please report vulnerabilities privately to the repository owner (use
GitHub's "Report a vulnerability" / security advisories feature if enabled,
or contact the maintainer via the project home). Do **not** open a public
issue for security problems. Include reproduction steps and affected
versions; you should receive a response within a few days.

## Scope notes

- woyomi executes third-party plugins in a per-plugin Web Worker sandbox,
  but plugins are **trusted software you choose to install** — only install
  plugins from repositories you trust. A malicious plugin repo can serve
  malicious code regardless of the sandbox.
- The self-hosted server (`apps/server`) is intended for personal use. The
  `/api/scrape` proxy is disabled by default; when enabled, set
  `SCRAPE_TOKEN` so your instance is not an open proxy. The proxy has an
  SSRF blocklist and size/timeout caps but no per-user rate limiting.
- The sync API (`/api/sync/:user`) is protected by a single shared
  `SYNC_TOKEN`; use a long random value and serve over HTTPS.
