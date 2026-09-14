# Binary distribution contract

Canonical invariants for Spinosa binary-only product installs (`1.0.3-beta.10`+).
Typed source of truth: `packages/spinosa-core/src/distribution/contract.ts`.

## Product assets (immutable version release)

| Asset | Role |
| ----- | ---- |
| `install.sh` | Platform binary installer |
| `spinosa-darwin-arm64` | macOS Apple Silicon executable |
| `spinosa-darwin-x64` | macOS Intel executable |
| `spinosa-linux-arm64` | Linux aarch64 glibc executable |
| `spinosa-linux-x64` | Linux x86_64 glibc executable |
| `checksums.txt` | SHA-256 for every immutable asset |
| `build-manifest.json` | Version, channel, template pack ID, asset map |

No `spinosa-v*.tar.gz` product archive. Rolling channel (`beta` / `stable`) publishes only `install.sh` + `checksums.txt`.

## Platform mapping

Canonical keys use `x64` (never `amd64` in asset names):

| Host OS | Host arch aliases | Asset key |
| ------- | ----------------- | --------- |
| Darwin | `arm64`, `aarch64` | `darwin-arm64` |
| Darwin | `x86_64`, `amd64`, `x64` | `darwin-x64` |
| Linux | `arm64`, `aarch64` | `linux-arm64` |
| Linux | `x86_64`, `amd64`, `x64` | `linux-x64` |

Unsupported: Windows, musl/Alpine (glibc Linux only), baseline non-AVX variants (first cut).

Installer (`install.sh`) and `resolveProductBinaryTarget` refuse musl when detectable
(`/etc/alpine-release`, `/lib/ld-musl-*`, or `ldd --version` mentioning musl) before download.

## Install layout

```text
$SPINOSA_HOME/          # default ~/.spinosa
  bin/spinosa           # active product binary
  templates/<version>-<packHash>/
  metadata/config.yaml
  metadata/workspaces.json
  logs/
  .staging/             # downloads / activation transaction
```

Legacy (dormant after migration, never auto-deleted):

```text
$SPINOSA_HOME/versions/
$SPINOSA_HOME/bin/bun
$SPINOSA_HOME/lib/
$SPINOSA_HOME/env.sh
```

## Metadata keys (`metadata/config.yaml`)

| Key | Meaning |
| --- | ------- |
| `spinosa: true` | Ownership marker |
| `last_installed_version` | Active product version |
| `distribution: binary` | Install mode after hard cut |
| `template_pack_id` | Embedded pack SHA-256 |
| `beta: true\|false` | Release channel toggle |
| `legacy_source_runtime: true` | Optional: dormant `versions/` still present |

Legacy keys remain readable.

## Template pack

- Enumerated from `workspace-files.tsv` via `listFrameworkManifestFiles`.
- Embed as a Bun file-import module (not a tar archive).
- Pack ID = SHA-256 of canonical relative paths + content hashes + executable modes.
- Cache path: `$SPINOSA_HOME/templates/<version>-<shortPackHash>/`.
- Extraction is atomic: write sibling temp dir → verify → write completion marker → rename.
- Partial caches are never treated as valid.
- Runtime workspace ops read only from the extracted cache (never Bun VFS).

## Workspace launcher

Embedded `.bin/spinosa` is a minimal forwarder to `$SPINOSA_HOME/bin/spinosa`.
Managed launchers migrate on ownership proof (known marker / known hash).
Modified launchers are preserved and reported. Migration never fails global install.

## Activation / rollback

1. Stage binary outside active path.
2. Verify checksum, `version --json`, template ensure/verify, doctor.
3. Backup active binary → atomic rename staged → active.
4. Verify active binary; commit metadata only after success.
5. On post-activation failure: restore backup; leave metadata at previous version.
6. Never delete `SPINOSA_HOME` or auto-delete `versions/`.

## Repair

Re-download and atomically reinstall the platform binary.
Not: `bun install`, OpenTUI links, `node_modules`, bundled Bun.

## Uninstall

Removes: `bin/spinosa`, `templates/`, `.staging/`, `logs/`, owned PATH shim.
Preserves: metadata, registered workspaces, legacy `versions/`.
Legacy cleanup requires an explicit confirmed option.

## Deprecated installer flags

| Flag | Behavior |
| ---- | -------- |
| `--no-bundled-tools` | Deprecated no-op with warning (one transition beta) |

## Compile constants

```text
SPINOSA_VERSION
SPINOSA_CHANNEL
SPINOSA_DISTRIBUTION=binary
SPINOSA_TEMPLATE_PACK_ID
SPINOSA_TEMPLATE_PACK_VERSION
```

## Product compile entrypoint

`packages/spinosa-kernel/src/index.ts` — not `packages/spinosa-cli`.

## Stable promotion

Documented soak + native four-platform gates required. Do not promote stable in the hard-cut beta.
See `docs/release/stable-promotion-gates.md`.

## Known cut notes (native packaging)

- OCR is the Spinosa-owned bundled Tesseract: per-platform `spinosa-tools-<os>-<arch>.tar.gz` release assets (Tesseract binary + pinned `tessdata` eng/ita/fra) install under `$SPINOSA_HOME/tools/<os>-<arch>/` with checksums verified before extraction. No companion-lib staging, no `LD_LIBRARY_PATH` re-exec. Tarballs are built locally from pinned source (`bun scripts/build-tools-tarballs.ts` — static Tesseract 5.5.3 + Leptonica, system-libs-only on macOS, fully static on Linux); no CI produces them and the release build stage fails closed when one is missing.
- Canvas skia natives (`skia.<triple>.node`) are written under `src/generated/canvas-libs/<os>-<arch>/` via `canvas-native.gen.ts` and staged at start into `$SPINOSA_HOME/cache/canvas-native` (home → XDG → tmpdir fallback order). `NAPI_RS_NATIVE_LIBRARY_PATH` is set before any canvas import so nested loads work on Linux Bun `--compile` (optional `@napi-rs/canvas-*` `require()` fails there even when doctor's direct canvas import succeeds).
- Host `darwin-arm64` strict smoke (`version` / `doctor`) is fail-closed: any smoke failure fails the release.
- pdfjs may warn that `@napi-rs/canvas` cannot load from some BunFS chunks while doctor still reports Canvas/PDF available. Non-blocking for CLI smoke; PDF raster follow-up tracked in the beta.10 checklist.

