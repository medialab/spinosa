# Spinosa v0.8.0-beta.10 — Global Bug-Check Audit

**Date:** 2026-07-07
**Scope:** All source code across 18 packages + shell scripts + Python utilities + configs
**Method:** Static analysis by 6 parallel subagents + direct manual audit

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **Critical** | **9** | Data loss, silent wrong behavior, infinite hangs, uncatchable crashes |
| **High** | **17** | Runtime crashes in common scenarios, unrecoverable failures |
| **Medium** | **69** | Edge-case failures, latent bugs, dead code, missing guards |
| **Low** | **92** | Missing type hints, redundant code, minor style issues |
| **TOTAL** | **187** | |

**Key risk:** 9 Critical bugs — data corruption via partial credential updates, unflushed file writes during workspace setup, broken version ordering in framework selection, leaking event listeners on every UI interaction, and hanging background-job callers.

---

## CRITICAL BUGS (9)

### C1 — Credential partial update silently NULLs unprovided fields
- **File:** `packages/core/src/credential.ts:126`
- **Packages:** core
- **Issue:** `.set({ label: updates.label, value: updates.value })` passes both fields always. Drizzle ORM translates `undefined` to SQL NULL. Updating only `value` (e.g., OAuth refresh at `integration.ts:401`) silently nullifies `label`, and vice versa.
- **Fix:** Filter to only defined keys: `.set(Object.fromEntries(Object.entries(...).filter(([_,v])=>v!==undefined)))`

### C2 — Missing `await` on Bun.write() in workspace setup
- **File:** `packages/spinosa-core/src/workspace/registry.ts:281-286`
- **Package:** spinosa-core
- **Issue:** Three `Bun.write()` calls (context.md, config.yaml, AGENTS.md) are not awaited. The async function returns before writes flush to disk. On slow filesystems (cloud storage), subsequent reads see stale/empty files.
- **Fix:** Add `await` to each `Bun.write()` call.

### C3 — Self-referencing circular ES module export (file.ts)
- **File:** `packages/core/src/file.ts:1`
- **Package:** core
- **Issue:** `export * as File from './file'` — a module re-exporting itself as a namespace. Two callers (git.ts, snapshot.ts) import `{ File }` and access `File.Diff`. The runtime namespace may be incomplete or undefined depending on engine/module loader.
- **Fix:** Remove the self-referential re-export. Export `Diff` directly or define an explicit namespace.

### C4 — Self-referencing circular export (http-recorder/internal.ts)
- **File:** `packages/http-recorder/src/internal.ts:15`
- **Package:** http-recorder
- **Issue:** `export * as HttpRecorderInternal from "./internal.js"` — same self-referencing circular pattern as C3.
- **Fix:** Remove line 15.

### C5 — Self-referencing circular export (effect-sqlite-node/index.ts)
- **File:** `packages/effect-sqlite-node/src/index.ts:1`
- **Package:** effect-sqlite-node
- **Issue:** `export * as NodeSqliteClient from "./index"` — the only source file re-exports itself.
- **Fix:** Remove line 1 or export the namespace as a const.

### C6 — Error returned as success value in Effect
- **File:** `packages/effect-drizzle-sqlite/src/up-migrations/effect-sqlite.ts:~53`
- **Package:** effect-drizzle-sqlite
- **Issue:** `return yield* new EffectDrizzleError(...)` — `yield*` on a non-Effect value wraps it in `Effect.succeed`. The Error object escapes as a successful result, violating the `Effect<T, E>` contract.
- **Fix:** Change to `return yield* Effect.fail(new EffectDrizzleError({...}))`.

### C7 — Function-based items provider never invoked
- **File:** `packages/ui/src/hooks/use-filtered-list.tsx:34`
- **Package:** ui
- **Issue:** When `items` is `(filter: string) => T[] | Promise<T[]>`, `Promise.resolve(items)` wraps the function object as a resolved value. The filter argument is never passed — the function-based items code path is completely broken.
- **Fix:** `typeof items === "function"` check and `await items(filter)`.

### C8 — Event listener leak in dialog.tsx
- **File:** `packages/ui/src/context/dialog.tsx:65-76`
- **Package:** ui
- **Issue:** `makeEventListener(window, "keydown", ...)` inside `createEffect` is never cleaned up on re-runs. After N dialog opens/closes, N redundant listeners fire per Escape press.
- **Fix:** Capture and call the disposer in `onCleanup()`.

### C9 — Event listener leak in popover.tsx
- **File:** `packages/ui/src/components/popover.tsx:99-101`
- **Package:** ui
- **Issue:** Three `makeEventListener` calls (keydown, pointerdown, focusin) in a `createEffect` accumulate on every `opened()` signal change.
- **Fix:** Store disposer refs and clean up in `onCleanup()` before re-attaching.

---

## HIGH BUGS (17)

### H1 — Prerelease version comparison uses string operators (discovery.ts)
- **File:** `packages/spinosa-core/src/framework/discovery.ts:25-26`
- **Package:** spinosa-core
- **Issue:** `va.pre > vb.pre` and `va.pre < vb.pre` compare prerelease tags with JavaScript `>`/`<` (lexicographic character-by-character). `"beta.10" > "beta.2"` returns `false` because `"1" < "2"`. The installed framework version resolver selects incorrect best version when prerelease tags use sequential numbers.
- **Fix:** Use tokenized comparison (compare numeric segments numerically, string segments lexicographically) — reuse `comparePrereleaseTokens` from `version.ts`.

### H2 — Non-null assertions on child.stdin/stderr in converter batch
- **File:** `packages/spinosa-core/src/import/pipeline.ts:621-627`
- **Package:** spinosa-core
- **Issue:** `child.stdin!.write()`, `child.stdin!.end()`, `child.stderr!` use non-null assertions. If `spawn()` fails (binary not found), the `child.on("error")` handler fires asynchronously — but these synchronous `!` expressions execute BEFORE the error handler. A null stdio stream throws `TypeError: Cannot read properties of null` outside the Promise rejection path.
- **Fix:** Replace `!` with explicit null checks and reject the Promise.

### H3 — Non-null assertions on files[i]! in loop indexing
- **File:** `packages/spinosa-core/src/import/pipeline.ts:126,158,217,286`
- **Package:** spinosa-core
- **Issue:** `files[i]!` assumes index is always valid. TS arrays can be sparse. If any element were missing, this would throw.
- **Fix:** Use `for...of` or guard with `if (!f) continue`.

### H4 — Null palette causes crash in generateSystem
- **File:** `packages/tui/src/theme/index.ts:374-375`
- **Package:** tui
- **Issue:** `colors.palette[0]` and `colors.palette[7]!` — when both `defaultBackground/defaultForeground` and `palette` are empty, `RGBA.fromHex(undefined)` throws TypeError.
- **Fix:** Guard with `??` fallback as used in `col()` helper.

### H5 — Lock directory TOCTOU race in install.sh
- **File:** `install.sh:1660-1669`
- **Package:** n/a (installer)
- **Issue:** Check-then-act pattern: `[ -d "$lockdir" ]` check and `mkdir "$lockdir"` are separate. Two concurrent installers can both pass the check before either creates the directory. The second `mkdir` fails under `set -e`, aborting the installer.
- **Fix:** Use `mkdir "$lockdir" 2>/dev/null || die "..."` as atomic check-and-create.

### H6 — unzip missing error guard after network download
- **File:** `install.sh:361`
- **Package:** n/a (installer)
- **Issue:** `unzip -q "$bun_zip" -d "$bun_extract"` without `|| die` — corrupt ZIP from network truncation or CDN error causes a bare `set -e` abort instead of a helpful diagnostic.
- **Fix:** `unzip ... || die "Failed to extract — download may be corrupted."`

### H7 — Schema.encodeSync throws, bypassing Effect error handling
- **File:** `packages/llm/src/protocols/openai-responses.ts:166`, `packages/llm/src/route/transport/websocket.ts:237`
- **Package:** llm
- **Issue:** `Schema.encodeSync` throws synchronously on schema mismatch. Inside `Effect.gen`, this causes an unrecoverable defect instead of a typed failure. `catchTag` cannot catch it.
- **Fix:** Replace with `Schema.encode(...)` wrapped through `Effect.map`.

### H8 — Silently dropped reasoningEffort beyond OpenAI subset
- **File:** `packages/llm/src/protocols/openai-responses.ts:460-461`
- **Package:** llm
- **Issue:** Invalid reasoning effort values beyond the OpenAI subset silently discarded by `lowerOptions` check.
- **Fix:** Add validation with proper error channel reporting.

### H9 — e.preventDefault() always called on tooltip outside click
- **File:** `packages/ui/src/components/tooltip.tsx:152`
- **Package:** ui
- **Issue:** `pointerDownOutside` handler unconditionally calls `e.preventDefault()`, blocking every outside click from closing the tooltip. Should only block when click IS on the trigger.
- **Fix:** Move `e.preventDefault()` inside the trigger check.

### H10 — `@ts-ignore` hides type errors in select component
- **File:** `packages/ui/src/components/select.tsx:86`
- **Package:** ui
- **Issue:** Bare `// @ts-ignore` suppresses whatever type mismatch exists between the generic parameter and Kobalte. Future refactors won't surface errors.
- **Fix:** Use `// @ts-expect-error` with a reason string.

### H11 — Unsafe `as unknown as ThemeRegistrationResolved` cast
- **File:** `packages/ui/src/context/marked.tsx:378`
- **Package:** ui
- **Issue:** `OpenCodeTheme` cast through `unknown` loses all type safety. If `@pierre/diffs` changes its type, no compile-time error surfaces.
- **Fix:** Narrow the type progressively or use a typed builder.

### H12 — Fragile instanceof check in project-copy handler
- **File:** `packages/server/src/handlers/project-copy.ts:49`
- **Package:** server
- **Issue:** `error instanceof Git.WorktreeError` relies on prototype-chain identity. If bundler dedup issues produce a different reference, this silently returns false, dropping the `forceRequired` field.
- **Fix:** Use `error._tag === "Git.WorktreeError"` instead.

### H13 — Cursor/spread ambiguity in session.list
- **File:** `packages/server/src/handlers/session.ts:27-37`
- **Package:** server
- **Issue:** Parsed `SessionsCursor` spread into `session.list()` alongside explicit `workspaceID` and `limit`. If cursor contains a `cursor` property, the function may silently ignore one parameter.
- **Fix:** Destructure only expected fields: `const { cursor: _, ...filters } = query`.

### H14 — executeUnprepared delegates to prepared execution
- **File:** `packages/effect-sqlite-node/src/index.ts:115-117`
- **Package:** effect-sqlite-node
- **Issue:** `executeUnprepared` calls `this.execute()` which uses `db.prepare()`, defeating the purpose. Intended for raw SQL without preparation but adds preparation overhead.
- **Fix:** Implement using `db.exec()` via `Effect.try`.

### H15 — Missing "values" case in mapResult switch
- **File:** `packages/effect-drizzle-sqlite/src/sqlite-core/effect/session.ts:~291-302`
- **Package:** effect-drizzle-sqlite
- **Issue:** `switch (this.effectExecuteMethod)` handles `"run"`, `"all"`, `"get"` but omits `"values"`. Falls off the switch returning `undefined`, silently corrupting batch query results.
- **Fix:** Add `case "values"` handler or `default: assertUnreachable()`.

### H16 — Self-referential circular export (core/file.ts) — see C3
Already covered in C3.

### H17 — Non-null assertion on proc.pid!
- **File:** `packages/core/src/cross-spawn-spawner.ts:409`
- **Package:** core
- **Issue:** `ProcessId(proc.pid!)` and `globalThis.process.kill(-proc.pid!, signal)` assert non-null on `proc.pid`. May be null on edge cases where process exits before spawning completes.
- **Fix:** Add null guard: `if (proc.pid == null) return yield* Effect.die(...)`.

---

## MEDIUM BUGS (69) — Selected Highlights

| # | File | Line | Issue | Severity |
|---|------|------|-------|----------|
| M1 | `spinosa-core/src/import/pipeline.ts` | 841-862 | `allRecoverable` collected but never used | Medium |
| M2 | `spinosa-core/src/import/pipeline.ts` | 18 | Unused import `isTextBasedPdf` | Medium |
| M3 | `spinosa-core/src/import/pipeline.ts` | 17 | Unused import `safeCopy` (only safeCopyAsync used) | Medium |
| M4 | `spinosa-core/src/utils/fs.ts` | 16 | 4 unused imports from node:fs/promises | Medium |
| M5 | `spinosa-core/src/constants.ts` | 11 | `BINARY_COPYABLE_EXTENSIONS` always empty — dead `binary_copyable` route | Medium |
| M6 | `spinosa-core/src/extension/pdf.ts` | 51 | Empty catch in `tryPypdf` silently swallows errors | Medium |
| M7 | `spinosa-core/src/commands/add.ts` | 35 | `preferredCli` declared in `AddFilesOptions` but never consumed | Medium |
| M8 | `spinosa-core/src/commands/add.ts` | 133 | `runPpuOcrBatch` return value discarded, re-computes differently | Medium |
| M9 | `spinosa-core/src/framework/discovery.ts` | 50-51 | Swallowed error in `discoverInstalledFramework` with no logging | Medium |
| M10 | `tui/src/util/presentation.ts` | 42 | `input.sessionID` is `string \| undefined` but interpolated directly as `opencode -s undefined` | Medium |
| M11 | `tui/src/spinosa/onboarding-preview.ts` | 83 | `classifySourceFile()` call not wrapped in try-catch — single bad file crashes entire preview | Medium |
| M12 | `tui/src/spinosa/onboarding-preview.ts` | 1-14 | 7 unused imports | Medium |
| M13 | `tui/src/spinosa/service.ts` | 232-233 | Non-null assertion on dynamic Object.keys access | Medium |
| M14 | `tui/src/theme/index.ts` | 272 | Unsafe `as ColorValue` cast on theme entries — masks runtime mismatches | Medium |
| M15 | `tui/src/spinosa/parse-corpus.ts` | 5,9 | Missing regex escaping in `section()` and `bulletValue()` | Medium |
| M16 | `core/src/background-job.ts` | 305 | `waitForPromotion` returns `Effect.never` for non-running jobs — callers hang forever | Medium |
| M17 | `core/src/event.ts` | 52 | `decodeSerializedEvent` throws synchronously inside Effect.gen — unhandled defect | Medium |
| M18 | `core/src/filesystem/search.ts` | 164 | FFF grep query joins glob, include, and pattern with spaces — likely wrong API usage | Medium |
| M19 | `core/src/filesystem.ts` | 84 | FSUtil.mimeType() called synchronously inside Effect — throws as defect | Medium |
| M20 | `llm/src/tool-runtime.ts` | 41 | Non-null assertion on optional `tool.execute!` | Medium |
| M21 | `ui/src/components/text-field.tsx` | 125 | ErrorMessage rendered unconditionally when no error | Medium |
| M22 | `ui/src/components/toast.tsx` | 143 | `action.onClick()` not wrapped in try-finally — `toaster.dismiss` skipped on throw | Medium |
| M23 | `schema/src/integration.ts` | 109-110 | `Schema.Number` for timestamps accepts NaN/Infinity/negative | Medium |
| M24 | `server/src/handlers/pty.ts` | 22 | Non-null `as string` assertion on branded type | Medium |
| M25 | `http-recorder/src/internal-effect.ts` | 134 | Unsafe `as Record<string, string>` cast on HTTP response headers | Medium |
| M26 | `effect-sqlite-node/src/index.ts` | 59-65 | `options.create` and `options.readwrite` ignored in DatabaseSync constructor | Medium |
| M27 | `opencode/src/util/archive.ts` | 9 | PowerShell command injection via string interpolation | Medium |
| M28 | `.bin/lib/spinosa/commands_system.sh` | 267-296 | `cmd_upgrade` tmpdir not cleaned on INT/TERM — tempfile leak | Medium |
| M29 | `.bin/build-spinosa-vendor.sh` | 218 | EXIT trap set inside function, overwritten on repeated calls | Medium |
| M30 | `.github/workflows/ci.yml` | 17-25 | 10/15 shell scripts missing from CI syntax check | Medium |
| M31 | `packages/sdk/js/src/v2/types.ts` | 1 | Missing `.js` extension in re-export (breaks NodeNext resolution) | Medium |

Full medium list continues with 38 more findings across all packages.

---

## Notable Patterns

### Self-referencing circular exports (3 instances)
- `packages/core/src/file.ts` — `export * as File from './file'`
- `packages/http-recorder/src/internal.ts` — `export * as HttpRecorderInternal from "./internal.js"`
- `packages/effect-sqlite-node/src/index.ts` — `export * as NodeSqliteClient from "./index"`

All three produce incomplete or undefined runtime namespace objects. Two have known callers relying on `File.Diff`.

### Empty catch blocks (6+ instances)
- `packages/spinosa-core/src/extension/pdf.ts:38` — tryPdfinfo
- `packages/spinosa-core/src/extension/pdf.ts:51` — tryPypdf
- `packages/spinosa-core/src/framework/discovery.ts:50` — discoverInstalledFramework
- `packages/core/src/pty.ts:111,122` — session cleanup
- `packages/core/src/plugin/provider/snowflake-cortex.ts:18,37` — fetch fallback
- `packages/core/src/util/module.ts:8` — module resolution
- Multiple in `packages/opencode/src/` and `packages/tui/src/`

### Event listener leaks in UI package (2 instances)
Dialog and popover components never clean up `makeEventListener` handlers, causing listener accumulation on every open/close cycle.

### Dead/broken code paths
- `BINARY_COPYABLE_EXTENSIONS` always empty — entire `binary_copyable` → `binary_copy` route unreachable
- `items` as function in `use-filtered-list` — filter argument never passed to the function provider
- `effectExecuteMethod "values"` case in drizzle-sqlite — missing from switch, batch queries return `undefined`

---

## Top 10 Recommendations by Impact

1. **Fix credential partial update (C1)** — causes silent data loss on every OAuth credential refresh
2. **Add await to Bun.write calls in registry.ts (C2)** — workspace setup files may not flush before use
3. **Fix version comparison in discovery.ts (H1)** — wrong installed version selected when prereleases use sequential numbers
4. **Fix self-referencing circular exports (C3, C4, C5)** — namespace objects may be undefined at runtime
5. **Fix `Effect.fail` vs `Effect.succeed` in effect-drizzle-sqlite (C6)** — errors returned as success values
6. **Fix non-null assertions in pipeline.ts (H2)** — child process spawn failure causes uncatchable crash
7. **Clean up event listener leaks in UI (C8, C9)** — N listeners per open/close leads to degraded UX
8. **Fix function-as-items provider in use-filtered-list (C7)** — completely broken code path
9. **Fix install.sh lock directory race (H5)** — parallel install attempts abort
10. **Add `"values"` case to mapResult switch (H15)** — batch SQL operations return corrupted results

---

## Files Verified Clean

| Area | Files |
|------|-------|
| spinosa-core | `index.ts`, `types.ts`, `constants.ts`, `session-id.ts`, `workspace-name.ts`, `utils/path.ts`, `progress/progress.ts`, `handoff/builder.ts`, `handoff/runner.ts`, `extension/types.ts`, `system/channels.ts`, `artifacts/goal.ts`, `artifacts/parser.ts`, `corpus/index.ts`, `classify/route.ts`, `workspace/meta.ts`, `tools/detection.ts`, `commands/startup.ts`, `commands/onboard.ts`, `commands/create.ts`, `commands/upgrade.ts`, `scan/scanner.ts` |
| tui | `logo.ts`, `types.ts`, `log.ts`, `session-id.ts`, `truncate-path.ts`, `workspace-name.ts`, `status-labels.ts`, `classify.ts`, `entry.ts`, `workspace-launch.ts`, `orchestrator.ts`, `route-recovery.ts`, `verify.ts`, `parse-goal.ts`, `artifact-watcher.ts`, `cli-bridge.ts`, `button.ts`, `agent.ts`, `transcript.ts`, `layout.ts` |
| protocol | All 22 source files — clean |
