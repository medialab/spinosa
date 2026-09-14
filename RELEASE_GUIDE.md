# Spinosa Release Guide

## Quick start

```bash
export GH_TOKEN=$(gh auth token)   # auto-detected if gh is logged in

# Beta release (from beta-dev branch only)
bun run release:beta:patch

# Stable release (from main branch only — after beta-dev→main promotion PR)
bun run release:stable:patch

# Preview without side effects
bun run release beta patch --dry-run
```

Requirements: clean tree, matching branch (`beta-dev` for beta channel, `main` for stable), `gh` authenticated.

Binary releases should be built where native verification is possible. Cross-compiled assets are unproven until each target passes native smoke (see stable gates below).

---

## Commands

| Command | Purpose |
| ------- | ------- |
| `bun run release:beta:patch` | Bump beta prerelease and publish |
| `bun run release:beta:minor` | Bump beta minor series |
| `bun run release:stable:patch` | Stable patch release |
| `bun run release:validate` | Preflight only (branch + quality) |
| `bun run release plan beta patch` | Show version bump without publishing |
| `bun run release:resume` | Resume the latest incomplete release |
| `bun run release:republish -- vX.Y.Z` | Republish only when checksums match (immutable) |

---

## Pipeline

One orchestrator: `script/release/index.ts`

```text
preflight → bump → build → verify-local → smoke → git-tag → publish-version → channel → verify-remote
```

State is tracked in `dist/v{VERSION}/.release-state.json` so releases can be resumed.

### Stages

1. **preflight** — channel↔branch enforcement, clean tree, `bun run quality`
2. **bump** — sync versions, commit, push; refresh release-state SHA to post-bump HEAD
3. **build** — build OCR tools tarballs first (below), then pack embedded templates, compile four product binaries via `script/build-release-binaries.ts`, stage `install.sh`, `checksums.txt`, `build-manifest.json`
4. **verify-local** — exact asset set (no source tarball), pins, checksums, executable bits
5. **smoke** — serve local assets over HTTP and run the real installer into a temp home (`SPINOSA_RELEASE_BASE_URL`)
6. **git-tag** — tag must equal HEAD/state SHA
7. **publish-version** — create immutable GitHub release with binaries + installer + checksums + manifest (refuse checksum/manifest clobber)
8. **channel** — sync rolling `beta`/`stable` tag + installer only (clobber allowed only here)
9. **verify-remote** — live installer pin check; `SPINOSA_SMOKE_REMOTE=1` also downloads the host binary and smokes it

Contract: [docs/release/binary-distribution-contract.md](docs/release/binary-distribution-contract.md).

---

## Quality gates

| Command | When | What |
| ------- | ---- | ---- |
| `bun run quality` | Every beta cut / `release:validate` | Parallel: product typechecks, frozen lockfile (dev), shellcheck, release-critical unit/TUI tests, installer bats, repo smoke |
| `bun run quality:binary` | Before binary cut / local binary sign-off | Distribution contract tests, installer bats, host binary build, installer HTTP smoke when assets exist |
| `bun run smoke` | Local iteration | Repo-root `version`/`doctor` + cwd |
| `bun run quality:full` | Before stable / deep sweep | Full typecheck-all, knip, syncpack, depcruise, all core+tui spinosa tests |

Quality is **local only** — no GitHub Actions quality workflow.

---

## What gets published

| Release | Tag | Assets |
| ------- | --- | ------ |
| Immutable version | `vX.Y.Z` | `install.sh`, `spinosa-darwin-arm64`, `spinosa-darwin-x64`, `spinosa-linux-arm64`, `spinosa-linux-x64`, `spinosa-tools-darwin-arm64.tar.gz`, `spinosa-tools-darwin-x64.tar.gz`, `spinosa-tools-linux-arm64.tar.gz`, `spinosa-tools-linux-x64.tar.gz`, `checksums.txt`, `build-manifest.json` |
| Rolling channel | `stable` or `beta` | `install.sh`, `checksums.txt` only |

No `spinosa-v*.tar.gz` product archive.

---

## Stable promotion gates (soak required)

Do **not** promote stable immediately after the first binary beta (`1.0.3-beta.10`).

Stable requires:

- Virgin install on all four platforms (no Bun / no tar product archive / no version-tree runtime)
- Source→binary migration from a real `1.0.3-beta.9` home (metadata + workspaces preserved; managed launchers migrated)
- Binary→binary upgrade + rollback fault injection
- Workspace create/update from embedded templates
- Feature smoke: TUI, PDF, OCR, MarkItDown, watcher
- Immutable remote assets match local checksums/manifest; rolling channel points at the verified version
- At least one beta soak cycle with no open release-blocking distribution defects

See the checklist in `docs/release/binary-distribution-contract.md` and `docs/release-signoff-template.md`.

---

## Local binary build

```bash
# Host platform only (faster iteration)
bun script/build-release-binaries.ts --out-dir dist/vLOCAL --version "$(jq -r .version package.json)" --channel beta --host-only

# Full four-target matrix (release machine)
bun script/build-release-binaries.ts --out-dir dist/v$(jq -r .version package.json) --version "$(jq -r .version package.json)" --channel beta
```

Linux VM soak (Lima): [docs/release/lima-linux-soak.md](docs/release/lima-linux-soak.md).

---

## OCR tools tarballs (local build, no CI)

`spinosa-tools-<os>-<arch>.tar.gz` (static Tesseract + pinned tessdata) is built
from pinned source on the release machine — nothing is downloaded as a binary,
and no CI produces these assets. Darwin targets compile on the Mac; Linux
targets compile inside local Lima guests (native arch).

One-time guest setup (release machine only):

```bash
limactl start --name spinosa-tools-linux-arm64 template://ubuntu
limactl start --name spinosa-tools-linux-x64 --arch x86_64 template://ubuntu
```

Prerequisites on the release Mac: Xcode command line tools, cmake, and Rosetta
(`arch -x86_64 /usr/bin/true` must succeed — configure-time probes for the
`darwin-x64` cross-build execute through it).

Build (before the release `build` stage, into the same dist dir):

```bash
DIST="dist/v$(jq -r .version package.json)"
bun scripts/build-tools-tarballs.ts --out-dir "$DIST"          # all four targets
bun scripts/build-tools-tarballs.ts --out-dir "$DIST" --host-only  # darwin-arm64 iteration
```

Each tarball is self-verifying: SHA256-pinned sources, fail-closed linkage
gates (system libs only on macOS, fully static on Linux), version/lang checks,
and a blank-PNG end-to-end OCR probe where the host can execute the binary.
The release `build` stage refuses to cut checksums when a tarball is missing.

---

## Version sync

Product version source: root `package.json`. Sync with `bun script/set-version.ts <version>` (also patches `install.sh` `PINNED_VERSION`).
