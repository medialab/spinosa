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
| `commands/upgrade.ts` | `upgradeFramework()`, `checkUpgradeAvailable()`, version cache |
| `commands/preflight.ts` | `runLaunchPreflight()`, Spinosa upgrade offer, stale template-pack Y/n (force refresh + post-update freshness re-check) before TUI, launch status lines, exit code `10` |
| `utils/version.ts` | `compareFrameworkVersions()`, `releaseChannel()`, `parseInstallPinnedVersion()` |
| `system/channels.ts` | Reads `beta: true\|false` from `~/.spinosa/metadata/config.yaml` |

Document converters (`markitdown-ts`, `pdfjs-dist`, `@napi-rs/canvas`) live in this package — not in `@spinosa/tui`. OCR is tesseract only (ppu-paddle-ocr/onnx removed).

Kernel commands `upgrade` and `preflight` are thin wrappers. Launch preflight runs in `packages/spinosa-kernel/src/cli/cmd/tui.ts` **before** the TUI worker spawns. Do not add a second preflight path in the bash launcher.

## Release

Product version source: root `package.json`. Sync with `bun script/set-version.ts <version>`. See `RELEASE_GUIDE.md`.
