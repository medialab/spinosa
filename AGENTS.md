# Spinosa (repo root)

Product: Spinosa framework + TUI + binary distribution. Beta channel: `beta-dev` branch. Stable: `main`.

## How releases work (agents: follow this, do not improvise)

**Betas are built and published by GitHub Actions, never locally.** The full
pipeline is `.github/workflows/release-beta.yml`; the process contract is
`RELEASE_GUIDE.md`; asset invariants are
`docs/release/binary-distribution-contract.md`.

Maintainer (or agent, with maintainer approval) prepares; CI builds:

1. Prepare `beta-dev`: merge feature work, add the CHANGELOG section, keep
   versions in sync (`bun scripts/set-version.ts <version>`).
2. Preview: `bun run release plan beta patch` → next version.
3. Gate the tag locally: `bun scripts/release/validate-tag.ts vX.Y.Z`
   (greater than previous beta tag, `package.json` match, CHANGELOG match).
4. Push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   The tag push IS the release approval — `v*` pushes are
   maintainer-restricted by tag protection rules.
5. CI validates → builds all four targets natively in parallel
   (macos-26, macos-26-intel, ubuntu-24.04-arm, ubuntu-24.04) →
   assembles `dist/` → publishes the immutable GitHub release with
   build-provenance attestation → rolls the `beta` channel.
6. Verify: `gh release view vX.Y.Z`, rolling `beta` tag points at the
   release commit, live installer serves the new `PINNED_VERSION`.

Dry-run without publishing (after workflow changes):
`gh workflow run release-beta.yml -f version=X.Y.Z -f dry_run=true`.
`ci-assemble --dry-run` runs finalize/verify/smoke FOR REAL and only
prints remote steps — a green local dry-run (with complete `dist/`)
predicts a green publish. Anticipate CI before pushing: run
`validate-tag`, `ci-assemble --dry-run`, and `quality` locally; clean-runner
gaps get fixed by making the job provision them, never by weakening gates.

`.github/workflows/release-beta.yml` must exist on `main` (GitHub runs tag
workflows from the default branch) and stay in sync with `beta-dev`.

## Building binaries and tools tarballs (what runs where)

- Product binaries (`spinosa-<os>-<arch>`): `bun scripts/build-release-binaries.ts
  --out-dir dist/vX.Y.Z --version X.Y.Z --channel beta [--only <target>]`.
  `--manifest-only` stages just the template manifest (CI assemble job).
- OCR tools tarballs (`spinosa-tools-<os>-<arch>.tar.gz`): from pinned
  source, `bun scripts/build-tools-tarballs.ts --out-dir dist/vX.Y.Z
  [--only <target>]`. Linux targets build natively on matching-arch hosts
  (CI runners) and inside Lima guests locally — never downloaded as binaries.
- Both scripts log timestamped, per-phase lines via `scripts/release/log.ts`
  (`step`/`info`/`ok`/`warn`/`fail`). Keep that convention: long compiles
  and guest provisioning must stay followable. Never pipe script output
  through `tail` when diagnosing — it hides errors.
- Release pipeline entry: `bun scripts/release/index.ts`
  (`validate` · `plan` · `beta|stable` · `ci-assemble` · `publish` · `resume`).
  CI uses `ci-assemble`; local fallback uses `beta patch` from `beta-dev`.

## Repo conventions agents must respect

- Conventional commits (`feat|fix|chore|docs(scope): …`).
- `template-pack.gen.ts` is a build artifact: builds overwrite it, restore the
  tracked stub afterwards (`git checkout -- <file>`), never commit it.
- `dist/` is git-ignored release workspace, not source.
- Tesseract/tessdata pins are the tools-tarball cache key: same pins → reuse
  (local tarballs, or `--reuse-previous` from published release assets
  after pin verification), never rebuild. A rebuild happens only on pin,
  flag, or platform changes.
- Pre-existing LSP diagnostics about `.ts` import extensions in `scripts/` are
  repo-wide config noise (bun-style imports) — do not "fix" them.
