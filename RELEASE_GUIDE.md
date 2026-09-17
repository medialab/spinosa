# Spinosa Release Guide

## Quick start (CI-built releases — primary path)

```bash
# Beta (from beta-dev)
bun run release plan beta patch
bun scripts/release/validate-tag.ts v1.2.0-beta.5
gh workflow run release-beta.yml -f version=1.2.0-beta.5 -f dry_run=true
git tag v1.2.0-beta.5 && git push origin v1.2.0-beta.5

# Stable (from main, after promoting soaked beta work)
bun run release plan stable patch
bun scripts/release/validate-tag.ts v1.2.1
gh workflow run release-beta.yml -f version=1.2.1 -f dry_run=true
git tag v1.2.1 && git push origin v1.2.1
```

The tag push IS the release approval. GitHub Actions validates the tag, then
(dry-run) builds all four targets natively in parallel (compile only),
assembles dist/ (structural checks only), and verifies with one end-to-end
installer smoke per platform. Real releases rebuild nothing: publish
promotes the exact dry-run bytes for the tag commit (fail closed with no
green dry-run), then publishes the immutable release with build-provenance
attestation and rolls the `beta` or `stable` channel.

Requirements: `v*` tag pushes restricted to maintainers (tag protection rules),
tag greater than the previous tag on the same line, `package.json` matching
the tag, CHANGELOG section present (CI validates all four fail-closed).

Dry-run without publishing: `gh workflow run release-beta.yml -f version=1.2.0-beta.5 -f dry_run=true`
(beta checks out `beta-dev`) or `-f version=1.2.1` (stable checks out `main`).

Workflow location rule: GitHub resolves and runs tag-triggered workflows
from the default branch (`main`), checking out the pushed tag itself. Keep
`.github/workflows/release-beta.yml` present on `main` and in sync with
`beta-dev` whenever the pipeline changes — a tag release runs main's copy.

## Local fallback (release machine builds everything)

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
| `bun run release:beta:patch` | Bump beta prerelease and publish (local fallback) |
| `bun run release:beta:minor` | Bump beta minor series |
| `bun run release:stable:patch` | Stable patch bump + local fallback publish |
| `bun run release:validate` | Preflight only (branch + quality) |
| `bun run release plan beta patch` | Show version bump without publishing |
| `bun scripts/release/validate-tag.ts vX.Y.Z` | Gate a beta or stable tag before pushing (greater-than-previous, version + changelog match) |
| `bun run release ci-assemble vX.Y.Z [--dry-run] [--finalize-only]` | Finalize dist/ + local gates; `--finalize-only` runs structural checks only (CI assemble job — runtime proof lives in the verify matrix); `--dry-run` keeps the full installer smoke for local prediction |
| `bun run release ci-publish vX.Y.Z` | Publish immutable release + roll channel — CI only, after every native verify passes |
| `bun run release:resume` | Resume the latest incomplete release |
| `bun run release:republish -- vX.Y.Z` | Republish only when checksums match (immutable) |

---

## Pipeline

One orchestrator: `scripts/release/index.ts`

```text
preflight → bump → build → verify-local → smoke → git-tag → publish-version → channel → verify-remote
```

State is tracked in `dist/v{VERSION}/.release-state.json` so releases can be resumed.

### Stages

1. **preflight** — channel↔branch enforcement, clean tree, `bun run quality`
2. **bump** — sync versions, commit, push; refresh release-state SHA to post-bump HEAD
3. **build** — pack embedded templates, compile four product binaries via `scripts/build-release-binaries.ts`, stage `install.sh`, `checksums.txt`, `build-manifest.json`
4. **verify-local** — exact asset set (no source tarball), pins, checksums, executable bits
5. **smoke** — serve local assets over HTTP and run the real installer into a temp home (`SPINOSA_RELEASE_BASE_URL`)
6. **git-tag** — tag must equal HEAD/state SHA
7. **publish-version** — create immutable GitHub release with binaries + installer + checksums + manifest (refuse checksum/manifest clobber)
8. **channel** — refresh rolling `beta`/`stable` GitHub Release only (retitle + replace installer and checksums; no Git tag is moved in CI)
9. **verify-remote** — live installer pin check; `SPINOSA_SMOKE_REMOTE=1` also downloads the host binary and smokes it

Contract: [docs/release/binary-distribution-contract.md](docs/release/binary-distribution-contract.md).

---

## Quality gates

| Command | When | What |
| ------- | ---- | ---- |
| `bun run quality` | Every beta cut / `release:validate` | Parallel: product typechecks, shellcheck, actionlint, release-critical unit/TUI tests, installer bats, repo smoke |
| `bun run quality:binary` | Before binary cut / local binary sign-off | Distribution contract tests, installer bats, host binary build, installer HTTP smoke when assets exist |
| `bun run smoke` | Local iteration | Repo-root `version`/`doctor` + cwd |
| `bun run quality:full` | Before stable / deep sweep | Full typecheck-all, knip, syncpack, depcruise, all core+tui spinosa tests |

Quality runs locally (`release:validate`), in the CI validate job, and as the
required PR gate (`quality.yml` functional-quality). The metrics baseline
(`quality:report`) is advisory only; coverage/mutation run manually.

Three levels, in order — each catches a different failure class:

1. **Local preflight** (`bun run quality`): typechecks, unit tests,
   installer bats, shellcheck, actionlint. Catches code and workflow
   errors before GitHub runs anything.
2. **GitHub dry run** (`dry_run=true`): the real pipeline on real runners
   (validate → build ×4 → assemble → verify ×4) with publish skipped.
   Catches runner-specific issues (macOS/ARM, artifacts, permissions).
   Its `assembled-dist` artifact (90-day retention) is what a later real
   release publishes — same commit, same bytes.
3. **Real release** (tag push): no rebuild, no retesting. Publish locates
   the green dry-run for the exact tag commit, re-verifies layout +
   checksums, and ships those bytes (fail closed with no green dry-run),
   then moves the rolling channel.

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
bun scripts/build-release-binaries.ts --out-dir dist/vLOCAL --version "$(jq -r .version package.json)" --channel beta --host-only

# Full four-target matrix (release machine)
bun scripts/build-release-binaries.ts --out-dir dist/v$(jq -r .version package.json) --version "$(jq -r .version package.json)" --channel beta
```

Linux VM soak (Lima): [docs/release/lima-linux-soak.md](docs/release/lima-linux-soak.md).

---

## OCR tools tarballs (removed)

Local OCR was removed (no engine ships): no `spinosa-tools-<os>-<arch>.tar.gz`
assets are built, cached, reused, or published anymore. The historical
pinned-source build (`scripts/build-tools-tarballs.ts`) was deleted. Scans
transcribe via a selected vision model or copy-as-is; digital PDFs extract via
pdf.js with no model needed.

---

## Version sync

Product version source: root `package.json`. Sync with `bun scripts/set-version.ts <version>` (also patches `install.sh` `PINNED_VERSION`).
