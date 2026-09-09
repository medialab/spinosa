# Upgrade consolidation handoff (2026-07-30)

Status: **implemented on `beta`**

## What shipped

### Launch and upgrade (`@spinosa/core`)
- `runLaunchPreflight()` in `packages/spinosa-core/src/commands/preflight.ts`.
- Preflight runs in `packages/spinosa-kernel/src/cli/cmd/tui.ts` **before** the TUI worker spawns.
- Kernel `preflight` command + launcher / `spinosa-cli` re-exec on exit code `10`.
- Upgrade engine and version cache consolidated in `commands/upgrade.ts`.
- Version cache: two-line file (`timestamp` + `version`), one-hour TTL.

### Workspace create
- `copyFrameworkManifestPaths()` in `framework/manifest.ts` — only `workspace-files.tsv` paths are copied.
- User-state dirs (`raw/`, `maps/`, `.logs/`, etc.) come from the manifest, not a blind tree copy.

### Release pipeline (local only)
- Custom TypeScript orchestrator in `script/release/` is the only release path (`bun run release:beta:patch`, etc.).
- Stages (see `script/release/stages.ts` / `state.ts`): `preflight`, `bump`, `build`, `verify-local`, `git-tag`, `publish-version`, `channel`, `verify-remote`.
- Commands: `validate`, `resume`, `publish` (republish), plus channel/increment entrypoints.
- Removed: `script/release.sh`, `script/release/publish-channel.sh`, `packages/spinosa-kernel/script/publish.ts`.
- No GitHub Actions quality workflow — `bun run quality` runs locally via `release:validate`.

### Quality gate
- `bun run quality` = typecheck + depcruise + knip + syncpack + shellcheck + tests.
- `bun script/typecheck-all.ts` typechecks all workspace packages (`tsc --noEmit`).

## Verification commands

```bash
bun run quality
bun run dev -- --version
cd packages/spinosa-core && bun test test/preflight.test.ts test/version-cache.test.ts
cd packages/tui && bun test test/spinosa/preflight.test.ts test/spinosa/install-release.test.ts
```

## Release

```bash
bun run release:beta:patch
# or republish without bump:
bun run release:republish -- v1.0.2-beta.N
```

See `RELEASE_GUIDE.md` and `DEVELOPMENT.md` for current maintainer docs.
