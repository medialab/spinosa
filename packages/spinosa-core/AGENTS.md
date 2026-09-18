# Spinosa core

This package owns workspace, corpus, import, artifact, and application-domain code.

- Do not import from the TUI package or from @opencode-ai packages.
- Keep filesystem writes atomic and workspace-compatible.
- Add focused Bun tests for every behavior change.
- Put research state transitions in @spinosa/runtime, not here.

## Upgrade and launch

| Module | Role |
| ------ | ---- |
| `framework/manifest.ts` | `readFrameworkFilesTsv()`, `copyFrameworkManifestPaths()` |
| `commands/create.ts` | Workspace creation from manifest-declared template paths |
| `commands/upgrade.ts` | `upgradeFramework()`, `checkUpgradeAvailable()` (2.5 s cache-miss timeout), version cache |
| `commands/preflight.ts` | `runLaunchPreflight()`, Spinosa upgrade offer, stale template-pack Y/n (force refresh + post-update freshness re-check) before TUI, launch status lines, exit code `10` |
| `system/boot.ts` | `runLaunchBootHealth()` after preflight: OpenCode Console User-Agent probe, stale-install cleanup, workspace index. Minimal stdout. Failures do not exit. |
| `utils/version.ts` | `compareFrameworkVersions()`, `releaseChannel()`, `parseInstallPinnedVersion()` |
| `system/channels.ts` | Reads `beta: true\|false` from `~/.spinosa/metadata/config.yaml` |

Document converters (`markitdown-ts`, `pdfjs-dist`, `@napi-rs/canvas`) live in this package — not in `@spinosa/tui`. No local OCR engine ships: scans transcribe via a vision model or copy-as-is, digital PDFs via pdf.js. Classify caches page text and convert reuses it for digital PDFs. Destination walks skip `node_modules` / `dist` / `.git`. Import diagnostic NDJSON is buffered.

Kernel commands `upgrade` and `preflight` are thin wrappers. Launch preflight runs in `packages/spinosa-kernel/src/cli/cmd/tui.ts` in parallel with the TUI worker. `runLaunchBootHealth()` runs in that same terminal after the worker answers ping. Failures log one line and do not exit. An accepted upgrade stops the worker and exits. Do not add a second preflight path in the bash launcher.

## Release

Product version source: root `package.json`. Sync with `bun script/set-version.ts <version>`. See `RELEASE_GUIDE.md`.
