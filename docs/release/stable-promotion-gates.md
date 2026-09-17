# Binary soak and stable promotion gates

Stable promotion is **out of scope** for the `1.0.3-beta.10` hard cut.
Complete at least one beta soak after the first binary beta before cutting stable.

## Soak checklist (beta)

- [ ] Virgin install macOS arm64
- [ ] Virgin install macOS x64
- [ ] Virgin install Linux arm64 glibc
- [ ] Virgin install Linux x64 glibc
- [ ] Source→binary migration from real `1.0.3-beta.9` home
- [ ] Binary→binary upgrade
- [ ] Same-version reinstall
- [ ] Failed download leaves previous install untouched
- [ ] Failed staged verification leaves previous install untouched
- [ ] Failed post-activation verification restores previous binary
- [ ] Workspace create from embedded templates
- [ ] Workspace update from embedded templates
- [ ] Corrupt template cache reconstructs
- [ ] Managed workspace launcher migration
- [ ] Modified workspace launcher preservation
- [ ] TUI launch from arbitrary cwd
- [ ] Doctor healthy in binary mode
- [ ] PDF / OCR / MarkItDown feature smoke on each native platform
- [ ] No open release-blocking defects (data loss, install/launch/workspace/upgrade/rollback)

## Stable cut prerequisites

- [ ] All soak items above green
- [ ] Immutable release assets match local checksums + build-manifest
- [ ] No `spinosa-v*.tar.gz` product archive
- [ ] Rolling channel points at the soaked immutable version
- [ ] `bun run quality` and `bun run quality:binary` green on release host
- [ ] Sign-off file completed (`docs/release-signoff-template.md`)

Do not run `release:stable:*` as the primary path. Cut stable through CI:

```bash
gh workflow run release-beta.yml -f version=X.Y.Z -f dry_run=true
git tag vX.Y.Z && git push origin vX.Y.Z
```

Local `release:stable:*` is fallback only. Linux glibc virgin rows: practical Lima steps in [lima-linux-soak.md](lima-linux-soak.md) (`scripts/lima-linux-soak.sh`).
