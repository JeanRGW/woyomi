# Vendored crate: tauri-runtime-wry

**Upstream:** crates.io `tauri-runtime-wry` **2.11.4** (verbatim copy of the
published crate, excluding the packaged `Cargo.lock` and `.cargo_vcs_info.json`;
the file `Cargo.toml` is the registry-normalized form with one local change
described below).

## Why this tree exists

The released `tauri-runtime-wry` depends on a single `wry` version. We need:

- **wry 0.56.1 on Windows** — fixes a WebView2 crash on window resize/maximize
  (wry#1794);
- **wry 0.55.x on Android and other targets** — the Android JNI code still
  needs the older wry until a released `tauri-runtime-wry` supports the newer
  Android API.

The only local modification to this tree is the target-split `wry` dependency in
`Cargo.toml`:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
wry = "0.56.1"

[target.'cfg(not(target_os = "windows"))'.dependencies]
wry = "0.55"
```

It is wired in via the workspace-wide `[patch.crates-io]` in
`../Cargo.toml`, so every crate resolving `tauri-runtime-wry` gets this tree.

## Risks while this patch exists

- A security-relevant runtime crate (window/IPC/protocol handling) is frozen at
  2.11.4 while `tauri` keeps floating forward. Upstream `tauri-runtime` /
  `tauri-utils` releases can silently desync from it.
- `Cargo.toml` pins `tauri`/`tauri-build` exactly so the patch cannot silently
  fall out of sync with a floating major.

## How to verify this tree matches crates.io 2.11.4

```sh
cargo download tauri-runtime-wry==2.11.4   # or fetch the .crate from crates.io
diff -ru tauri-runtime-wry-2.11.4/ vendor/tauri-runtime-wry/ \
  --exclude Cargo.toml --exclude Cargo.lock --exclude .cargo_vcs_info.json
```

The only source modification is `Cargo.toml` (the wry split above). The packaged
lockfile and VCS metadata are intentionally omitted. CI excludes those three
files but compares every source file in the `vendor-drift` job.

## Removal checklist

Remove this vendor tree and the `[patch.crates-io]` entry as soon as **all** of
the following hold:

1. A released `tauri-runtime-wry` supports wry >= 0.56.1 on Windows **and**
   wry >= 0.56.1 (or equivalent Android JNI support) everywhere else — i.e. the
   split is no longer needed.
2. The Windows WebView2 resize/maximize crash (wry#1794) is fixed in the wry
   version that the released runtime pulls in.
3. `cargo check` passes on all targets without the patch, and the smoke test +
   a manual resize/maximize check on Windows pass.

Also track upstream for a `tauri-runtime-wry` release that lets dependants
express the wry split themselves, which is the real fix.
