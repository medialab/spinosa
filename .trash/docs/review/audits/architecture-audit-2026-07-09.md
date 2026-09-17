# Spinosa Architecture Audit — 2026-07-09

## Executive Summary

The codebase has solid fundamentals (clean opencode fork extension pattern, working dual-channel release flow, comprehensive agent framework) but carries significant tech debt from its rapid iteration history. The main structural issues are: version schizophrenia, framework bloat, bash sprawl, CI poverty, and dead code accumulation.

---

## 1. Version Schizophrenia (CRITICAL)

**Problem:** Three different version numbers exist in the codebase:

| Location | Version | Meaning |
|----------|---------|---------|
| `package.json` (root) | `0.8.0-beta.16` | Spinosa framework (just added) |
| `packages/*/package.json` (14 packages) | `1.17.12` | Upstream opencode version |
| `packages/protocol/package.json` | *(missing)* | No version field |
| `packages/schema/package.json` | *(missing)* | No version field |
| `script/build-tui.ts` | Was `0.8.0-beta.12` | TUI binary (now reads from root) |

Before Phase 1, the framework version lived only in `install.sh` as `PINNED_VERSION`. Now it's in `package.json` but the workspace packages still carry `1.17.12` — the upstream opencode version. These are **completely disconnected realities**.

**Impact:** If someone runs `bun version` or tooling that reads workspace package versions, they see `1.17.12`, not `0.8.0-beta.16`. The `@spinosa/tui` npm package was published at `0.1.3` (latest) while the framework was at `0.8.0-beta.16`.

**Fix:** Either:
- (A) Sync all workspace package versions to the framework version (simplest, but loses upstream tracking)
- (B) Keep workspace packages on their upstream version and make root `package.json` the single framework version
- (C) Use a `metadata/version` file as the canonical version, keep `package.json` for the Bun workspace (which doesn't use version for private packages)

Recommendation: (B) — the workspace packages are all `private: true`; their versions are irrelevant to consumers. The root `version` is what matters.

---

## 2. Framework Tarball Bloat (HIGH)

**Problem:** The framework tarball ships **15 packages** (~250K+ lines of TypeScript) into every user workspace. Only **3 are spinosa code**:

| Spinosa packages | Upstream opencode (shipped only for dep resolution) |
|------------------|------------------------------------------------------|
| `packages/spinosa-core/` | `packages/core/` |
| `packages/tui/` | `packages/effect-drizzle-sqlite/` |
| `packages/opencode/` | `packages/effect-sqlite-node/` |
| | `packages/http-recorder/` |
| | `packages/llm/` |
| | `packages/plugin/` |
| | `packages/protocol/` |
| | `packages/schema/` |
| | `packages/script/` |
| | `packages/sdk/js/` |
| | `packages/server/` |
| | `packages/ui/` |

The other 12 are shipped because `bun install --production` needs workspace deps to resolve. But these packages are **never modified by Spinosa** — they're straight copies of upstream opencode.

**Impact:** 
- Tarball is larger than necessary
- `spinosa update` copies all 15 packages into every workspace on every update
- `install.sh` runs `bun install --production` which resolves deps for all 15, not just the 3 spinosa ones
- Any upstream opencode change requires recopying 12 packages into the spinosa repo

**Fix:** 
- Pre-install `node_modules` in CI and ship them in the tarball, OR
- Restructure so the 12 upstream packages live in a separate workspace that's an npm dependency rather than shipped source, OR
- At minimum, document why this structure exists and accept the cost

---

## 3. Agent Configuration Duplication (MEDIUM)

**Problem:** 5 identical copies of skill directories (12 skills each = 60 directories) and 4 formats of agent definitions (11 agents each = 44 files) exist on disk:

```
.agents/skills/     ← source of truth
.codex/skills/      ← mirror
.claude/skills/     ← mirror
.opencode/skills/   ← mirror
.hermes/skills/     ← mirror

.agents/agents/     ← source of truth (.md)
.codex/agents/      ← mirror (.toml)
.claude/agents/     ← mirror (.md)
.opencode/agents/   ← mirror (.md)
```

`.bin/sync-agents.sh` (416 lines of bash) keeps them in sync. This is the right pattern (single source of truth + generated mirrors) but:

- The mirrors are **committed to git** rather than generated at build/install time
- `sync-agents.sh` is run during `spinosa update`, adding 30+ seconds to every workspace update
- If someone edits a mirror directly (bypassing the script), drift occurs silently

**Fix:** Generate mirrors at install/update time from `.agents/` source. Don't commit generated files. This is what `sync-agents.sh` already does — the question is just whether to commit the output.

---

## 4. Bash Sprawl (MEDIUM)

**Problem:** ~3,000+ lines of bash across ~20 files:

| File | Lines | Role |
|------|-------|------|
| `install.sh` | 1458 | User-facing installer |
| `.bin/spinosa` | 288 | CLI shim |
| `.bin/package-release.sh` | 326 | Framework packaging |
| `.bin/publish-release.sh` | 341 | GitHub release publish |
| `.bin/sync-agents.sh` | 416 | Agent mirror sync |
| `.bin/check-startup.sh` | ~400 | Startup validation |
| `.bin/validate-skills.sh` | ~150 | Skill validation |
| 10+ `test-*.sh` files | ~200 each | Integration tests |

These scripts must be **macOS bash 3.2 compatible** (the default on macOS since 2007). This means no `[[` outside functions, no `local` at global scope, no `$'...'`, no associative arrays. Many bugs in the changelog (`v0.7.1`, `v0.7.2`, `v0.7.3`, `v0.8.0-beta.2`, `v0.8.0-beta.9`, `v0.8.0-beta.10`) were bash-3.2 compatibility issues.

**Impact:** Every new feature in the installer or CLI risks a macOS-specific bash bug. The test surface is large and fragile.

**Fix:** 
- `install.sh` must stay bash (it runs before Bun is installed). But it could be simplified by moving logic to TypeScript that runs post-Bun-install.
- `.bin/spinosa` could be a compiled Bun binary (via `bun build --compile`), making it a single portable executable.
- Integration tests should move to TypeScript/Bun test runner, not bash.

---

## 5. CI Poverty (HIGH)

**Problem:** The only CI is `.github/workflows/ci.yml` which does:
- `bash -n` syntax check on 5 scripts
- `bash .bin/check-startup.sh`
- `bash .bin/check-doc-contract.sh`
- `bash .bin/validate-skills.sh`
- Checks that `framework-files.tsv` and `RELEASE_GUIDE.md` exist

**What's missing:**
- No TypeScript compilation (`tsgo --noEmit`)
- No test execution (`bun test`)
- No build verification (framework tarball creation)
- No release pipeline (covered in Phase 2 of the migration plan)
- No cross-platform testing (only `ubuntu-latest`)

**Impact:** A PR that breaks TypeScript compilation or fails `bun test` passes CI. The only gate before publishing is human discipline.

**Fix:** Add `typecheck` and `test` jobs to CI. This is trivial — the scripts already exist in `package.json`. Just need to add Bun setup and run them.

---

## 6. Dead Code (LOW)

**Problem:** Files that are documented as retired but still exist:

| File | Lines | Status |
|------|-------|--------|
| `.bin/build-spinosa-vendor.sh` | 335 | Retired v0.8.0-beta.12 |
| `.bin/test-install-vendor-reuse.sh` | ~60 | Retired v0.8.0-beta.12 |
| `RELEASE_GUIDE.md` references to vendor tarballs | ~30 lines | Stale docs |

The `publish-release.sh` also has dead code for `VENDOR_ASSETS` (lines 150-156, 297-303 in package-release.sh) that iterates `spinosa-vendor-*.tar.gz` — these files no longer exist.

**Fix:** Remove or move to `.trash/`. Update docs.

---

## 7. Root `package.json` Has Unexplained Dependencies (LOW)

```json
"dependencies": {
    "@ff-labs/fff-bun": "...",
    "@opentui/core": "...",
    "@parcel/watcher": "..."
}
```

These are runtime dependencies on the root package (which is `private: true` and never published). They're likely needed by workspace packages but placed at root for hoisting. This works with Bun workspaces but is confusing — a developer looking at root wouldn't know which package actually needs these.

**Fix:** Move to the specific workspace package that depends on them, or add a comment explaining workspace hoisting.

---

## 8. No Fork Tracking (MEDIUM)

`packages/opencode/` is a fork of `anomalyco/opencode`. There's no:
- Git submodule or subtree
- `UPSTREAM.md` documenting the fork point (which commit was forked)
- Script to diff against upstream
- List of intentional changes vs upstream

The `DEVELOPMENT.md` says "Do not modify packages/opencode/src/" — but grep shows zero spinosa-specific code in opencode. So either the fork is clean (no modifications), or modifications are elsewhere. Either way, it's undocumented.

**Fix:** Add `packages/opencode/UPSTREAM.md` with: fork commit hash, last sync date, and a policy for when/how to pull upstream changes.

---

## 9. Missing Error Handling in TypeScript Build Pipeline (MEDIUM)

`script/build-tui.ts` and `script/publish-tui.ts` import from `../packages/opencode/node_modules/@opentui/solid/scripts/solid-plugin.ts` — a path through another package's `node_modules`. This works only if `bun install` has been run in `packages/opencode/`. If not, the import fails at runtime with a cryptic error.

The build also calls `bun install` for 12 platform targets with platform-specific flags (`--platform=darwin --target=bun-darwin-arm64`). If any target fails, the script continues silently.

**Fix:** Add pre-flight checks (is `packages/opencode/node_modules` present?), wrap each target build in try/catch, report failures explicitly.

---

## 10. Patch Debt (LOW but notable)

**Problem:** 14 patched dependencies in `patches/`:

```
@ai-sdk/google@3.0.73
@ai-sdk/xai@3.0.82
@ff-labs/fff-bun@0.9.3
@modelcontextprotocol/sdk@1.29.0
@npmcli/agent@4.0.2
@pierre/trees@1.0.0-beta.4
@silvia-odwyer/photon-node@0.3.4
@standard-community/standard-openapi@0.2.9
@tanstack/solid-virtual@3.13.28
@tanstack/virtual-core@3.17.0
effect@4.0.0-beta.83
gcp-metadata@8.1.2
pacote@21.5.0
solid-js@1.9.10
```

This is the highest patch count I've seen in a production codebase. Bun's patch system is good, but 14 patches mean 14 things that break on every dependency upgrade. Several are on beta versions (`effect@4.0.0-beta.83`, `@pierre/trees@1.0.0-beta.4`) which will churn.

**Fix:** For each patch: document WHY it exists (what upstream bug). Prioritize upstreaming patches. For beta deps, track when they go stable and whether patches are still needed.

## 11. OpenCode Fork: Dependency Duplication (MEDIUM)

**Found by:** Package structure audit (subagent)

`packages/opencode/package.json` duplicates ~40 AI SDK provider dependencies that already exist in `packages/core/package.json`. Example: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, etc. appear in BOTH packages' `dependencies`.

This doubles the install footprint and creates risk of version skew between the two copies. The cause: `opencode` imports these directly rather than re-exporting from `core`.

**Fix:** Make `opencode` depend on `core` for provider access rather than listing them independently. Or accept the duplication as intentional (different bundle contexts).

## 12. TUI Bypasses Core Exports (MEDIUM)

**Found by:** Package structure audit (subagent)

`packages/tui/` imports from `@opencode-ai/core` internals that are not in the package's explicit `exports` map. Specifically, it reaches into `src/` paths that the `"./*": "./src/*.ts"` wildcard export makes available but are not intended as public API.

This means any internal refactor in `core` can silently break the TUI. The wildcard export `"./*": "./src/*.ts"` makes the entire source tree public.

**Fix:** Define explicit, narrow exports for the API surface `core` intends to expose. Make TUI use only those. Or document the wildcard export as intentional "open-core" design.

## 13. Orphaned spinosa-core Package (MEDIUM)

**Found by:** Package structure audit (subagent)

`packages/spinosa-core/` has zero internal workspace dependencies. It depends only on external npm packages (`pdfjs-dist`, `paddle-ocr`, `markitdown-ts`, `@napi-rs/canvas`). Architecturally it's a standalone PDF/OCR/conversion library with no connection to the Spinosa agent framework — it could be published as an independent npm package.

Its name `@opencode-ai/spinosa-core` is misleading — it has nothing to do with opencode's core. It's a document processing toolkit.

**Fix:** Rename to something descriptive (`@spinosa/document-tools`?) or document why it carries the `spinosa-core` name.

## 14. CLAUDE.md Frontmatter Duplication Bug (LOW)

**Found by:** Agent config audit (subagent)

`CLAUDE.md` (generated by `sync-agents.sh` from `AGENTS.md`) has two `generated_by` keys in its YAML frontmatter: one from the script and one leftover from a previous run. This is a bug in the sync script — it appends without cleaning stale keys.

## 15. Hermes Lacks Agent Directory (LOW)

**Found by:** Agent config audit (subagent)

`.hermes/` has `skills/` and `references/` mirrors but NO `agents/` directory. Hermes cannot dispatch native sub-agents — it relies entirely on the AGENTS.md orchestrator contract. This is probably intentional (Hermes has no sub-agent registry) but undocumented.

## 16. SDK Nested at sdk/js/ (LOW)

**Found by:** Package structure audit (subagent)

`packages/sdk/js/` is the only nested workspace package. The extra `js/` level suggests plans for other language SDKs (Python? Rust?) that don't exist. It adds path depth without purpose.

**Fix:** Flatten to `packages/sdk/` until a second language SDK actually exists.

## 17. No Content Drift in Agent Mirrors (GOOD)

**Found by:** Agent config audit (subagent)

`sync-agents.sh` uses `rsync --delete` for skills/references mirrors, which correctly eliminates stale files. All 5 vendor directories are structurally identical to the `.agents/` source. The sync is working correctly.

## 18. Route Types Are Hardcoded, Not Plugin-Registered (MEDIUM)

**Found by:** Fork architecture audit (subagent)

`packages/tui/src/context/route.tsx` defines the `Route` and `RouteNavigateInput` union types with hardcoded spinosa route discriminants (`workspace-picker`, `startup-hub`, `onboarding`, `add-files`). Adding a new route type requires modifying this union.

A plugin-registration pattern (e.g., a `Map<string, RouteComponent>`) would allow spinosa to add routes without touching opencode's route system.

**Fix:** Convert route registration from a hardcoded union to a dynamic registry. This also makes it easier to pull upstream opencode changes.

## 19. home.tsx Has Direct Spinosa Imports (LOW)

**Found by:** Fork architecture audit (subagent)

`packages/tui/src/routes/home.tsx` directly imports spinosa-specific components (`SpinosaPromptChips`, `DialogSpinosaWorkspacePicker`, framework upgrade logic). These should be injected via provider/slot pattern rather than hard-imported.

## 20. Fork Was Done via git-filter-repo Subtree (GOOD)

**Found by:** Fork architecture audit (subagent)

The opencode fork was imported via `git filter-repo` subtree at commit `7b25f9e58d448b2d7b320902a870c7458c6e899a` (v1.17.12). The TUI rendering was then extracted into `packages/tui/` as a separate workspace package. No `.gitmodules` — this is a subtree, not a submodule. The 6-line `packages/opencode/src/cli/tui/layer.ts` is the sole integration bridge. This is architecturally sound.

## 21. ~350 Lines Duplicated Between install.sh and Framework Libraries (HIGH)

**Found by:** CLI architecture audit (subagent)

`install.sh` contains independent implementations of logging, version comparison, checksum verification, tarball extraction, and version-completion tracking — all of which exist in `.bin/lib/spinosa/`. This is because install.sh runs before the framework is installed, so it can't source the libraries.

The duplication means every change to `safe_untar`, `sha256_file`, or `compare_versions` must be made in TWO places. The subagent found that `install.sh`'s `safe_untar` has security checks (path traversal prevention) that `.bin/lib/spinosa/core.sh`'s version is MISSING — the production CLI is less secure than the installer.

**Fix:** Extract shared functions into a standalone file that can be sourced by both install.sh and the framework libraries. Or, accept the duplication but add a linter check that warns when the two copies diverge.

## 22. macOS sort -V Bug Can Cause Silent Install Failure (HIGH)

**Found by:** CLI architecture audit (subagent)

`install.sh` uses `sort -V` (version sort) to find the latest complete version. macOS's BSD `sort` does not support `-V` — it silently ignores the flag and does a lexicographic sort, which can produce wrong ordering for versions like `0.8.0-beta.16` vs `0.9.0`.

The framework library version (`install_state.sh`) has a workaround (GNU coreutils `gsort` detection), but install.sh's embedded copy does not — it calls `sort -V` directly and in one code path uses `tail -1` which on macOS picks the wrong version.

**Fix:** Replace `sort -V` with the `compare_versions` function that's already defined in install.sh. Or pre-install GNU coreutils and use `gsort`.

## 23. CLI Library Structure Is Solid (GOOD)

**Found by:** CLI architecture audit (subagent)

The command dispatch in `.bin/spinosa` sources libraries from `.bin/lib/spinosa/` (9 files, well-separated by concern: core.sh, install_state.sh, commands_*.sh, handoff.sh, logging_bootstrap.sh). The library files are shipped to `~/.spinosa/lib/` by install.sh. This is a clean architecture — commands are isolated, shared utilities are centralized.

---

## Priority Matrix

| Priority | Item | Effort | Risk |
|----------|------|--------|------|
| **P0** | Version unification (done in Phase 1) | Done | Low |
| **P0** | Fix macOS `sort -V` → silent version detection failure | 30m | High |
| **P0** | CI: add typecheck + test jobs | 1h | None |
| **P0** | CI: add release pipeline (Phase 2) | 1d | Medium |
| **P1** | Fix safe_untar security divergence (installer vs CLI) | 1h | Medium |
| **P1** | Remove dead code (vendor scripts, stale docs) | 30m | None |
| **P1** | Document fork policy (`UPSTREAM.md`) | 15m | None |
| **P1** | Fix CLAUDE.md frontmatter duplication | 5m | None |
| **P1** | Deduplicate ~40 AI SDK deps in opencode vs core | 2h | Medium |
| **P2** | Generate agent mirrors at build time, don't commit | 2h | Medium |
| **P2** | Framework tarball rationalization | 4h | High |
| **P2** | Reduce bash surface (compile CLI to binary) | 4h | High |
| **P2** | Patch audit and documentation | 2h | Low |
| **P2** | Define explicit core exports, stop TUI from using wildcard | 2h | Medium |
| **P2** | Convert route types to plugin-registration pattern | 3h | Medium |
| **P2** | Flatten `sdk/js/` → `sdk/` | 1h | Low |
| **P2** | Extract shared bash functions to avoid install.sh/CLI duplication | 3h | Medium |
| **P3** | Clean root package.json deps | 30m | Low |
| **P3** | Rename/document spinosa-core package purpose | 15m | None |
| **P3** | Document Hermes agent gap | 5m | None |
| **P3** | Decouple home.tsx from direct spinosa imports | 2h | Low |
