# Changelog

All notable user-facing changes to Spinosa are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Release policy:** versions are published only with explicit maintainer approval.

## [Unreleased]

## [1.1.0-beta.10] — 2026-09-09

### Changed

- Flush left — no left border pad (`install.sh:183` `●` at col 0, `→` black bold `install.sh:217`, `preflight.ts:227` `●` flush) plus early `echo` pad removal `install.sh:17`.
- Workspace updates unified: `preflight.ts:225` `offerWorkspaceUpgrades` now `force:true` — `spinosa upgrade` does version + pack in one `?` prompt, no second `Workspace template pack update` `preflight.ts:296` round.

### Fixed

- `beta` check TTL `300s` / `stable` `3600s` `upgrade.ts:54` `versionCacheTtlSec()` (was `3600`), `spinosa` finds `beta.10` after 5m not 1h.
- `tui` setup brief toast removed `home.tsx:329`.

## [1.1.0-beta.9] — 2026-09-09

### Changed

- Flush left — no left border pad (`install.sh:183` `printf '%s %s\n'` `●` at column 0, `→` black `install.sh:217` bold title, `note` flush). `preflight.ts:227` workspace `●` flush.
- Workspace `Downloads` scan fully removed from installer (`install.sh:2154` `migrate_workspace_launchers` deleted) — normal install no longer touches workspaces, TUI `listRegisteredWorkspaces` still picks up `workspaces.json`.
- Tidy top-level: `test/`→`tests/installer/`, `tests/`→`tests/pipeline/`, `script/`→`scripts/` `35247715` + `package.json:41` `bats tests/installer` + `knip.json` + `.gitignore:45`.

### Fixed

- Shellcheck `DIM` unused + `printf` `%s` count `install.sh:177,2185` `cdf44a48`.
- Preflight workspace prompts now dotted `●` green/blue/red + `?` cyan `preflight.ts:219,373` (was `✨`/`↷`/`✓`/`⚠`/`•`) and Title `Checking for updates...` `preflight.ts:39`.

## [1.1.0-beta.8] — 2026-09-09

### Changed

- Installer now quiet by default: `--verbose`/`SPINOSA_VERBOSE=1` gates `Platform`, `Install root`, `checksum`/`template`/`doctor`/`activate`/`shim`/`PATH` details (`install.sh:145` `vinfo`/`vok`/`vnote`); `Download` + `Verifying package` + `Installing` waves always visible, `Download & verify` section always shown. Removed disk-space probe and workspace `Downloads` scan that triggered macOS privacy prompt (`install.sh:994` `check_download_disk_space` dropped, `migrate_workspace_launchers` removed from install).
- Terminal style B/W except dots: `●` green `ok` / cyan `info` / red `die` `install.sh:183`; banner and section titles monochrome (`→` black, title bold `install.sh:217`), section arrows black, wave `▁▂▃▄▅▆▇█` plus ` Verifying package`/` Installing` fixes silent hold after download.

### Fixed

- `Install log: ~/.spinosa/logs/spinosa.log` now clickable `file://` OSC 8 hyperlink on macOS Terminal `install.sh:2201`; `In new terminals: source …` now verbose-only `install.sh:1967`; `Install log` has `●` dot.
- Prompts `Repair`/`Upgrade`/`Downgrade`/`Install`/`Reinstall` now `?` cyan `install.sh:641` (was `○`); `Local version at ~/.spinosa/bin/spinosa: X.Y.Z` `install.sh:2111`; `✨ Spinosa installed successfully! ✨` bold with single blank line `install.sh:2191`.

## [1.1.0-beta.7] — 2026-09-09

### Changed

- Unified terminal dialogues to `│ ●` + wave `▁▂▃▄▅▆▇█` across all `.sh` (`install.sh`, `script/lima-linux-soak.sh`, `script/patch-local-install.sh`, `script/lint-shell.sh`) and `spinosa upgrade` (`packages/spinosa-kernel/src/cli/cmd/upgrade.ts` now `@clack/prompts` only, no `→`/`✦`/`⚠`).

### Fixed

- `spinosa upgrade` no longer warns `Warning: "version" is a reserved word` (`yargs.version(false)` `packages/spinosa-kernel/src/cli/cmd/upgrade.ts:22`).
- Shell UI now compatible with macOS Bash 3.2 and Linux Bash 5.3, TTY + piped + `NO_COLOR=1` (`install.sh:171`).

## [1.1.0-beta.6] — 2026-09-09

### Fixed

- Linux installer hang: bounded `flush_pending_input` no longer drains `stdin` pipe with non-consuming `read -t 0`; interactive prompts now return on Linux Bash 5.3 (`install.sh`).
- Version probes now time out in 5s and fall back to metadata, so a hanging active binary no longer blocks repair before download (`install.sh`, `packages/spinosa-core/src/commands/upgrade.ts`, `preflight.ts`, `packages/spinosa-kernel/src/cli/cmd/upgrade.ts`).
- Channel version fetch keeps abort deadline through body read (`packages/spinosa-core/src/system/channels.ts`); outer installer now runs async with 15min pgid supervision and streamed phase output (`packages/spinosa-core/src/commands/upgrade.ts`).
- Bootstrap now publishes `curl --connect-timeout 30 --max-time 600 --retry 3 -o /tmp/spinosa-install.sh && bash` instead of `| bash` (`README.md`, `website/src/lib/install-urls.ts`, `install.sh`).
- Release smoke gate fails when `install.sh` fails — no binary-copy fallback (`script/smoke-install.ts`, `script/release/stages.ts`).
- Workspace launcher classifier now reads only regular files with bounded `head` and per-workspace log; disk, migrate, and shell PATH steps are timed (`install.sh`).
- Early attempt log captured to `/tmp/spinosa-install-*.log` and merged into `~/.spinosa/logs/spinosa.log`; template/doctor diagnostics preserved instead of `>/dev/null` (`install.sh`).
- Process-group termination with TERM→KILL grace and owner-checked lock cleanup (`install.sh`); TUI reinstall now 900s, pgid-aware, stderr-surfaced, and tools step cancelable (`packages/tui/src/spinosa/reinstall.ts`, `add-files.tsx`, `onboarding.tsx`).
- Legacy `v0.5/v0.6` `metadata/install.yaml` and `v0.7/v0.8` completion stamps are now recognized as owned, not reclaimable debris (`install.sh`); metadata migration now warns instead of silently ignoring.
- Binary rollback now restores shim, `config.yaml`, and `env.sh` alongside the binary with verification (`install.sh`).
- Upgrade failure hint now derives from the effective channel and shows the bounded bootstrap command (`packages/spinosa-kernel/src/cli/cmd/upgrade.ts`).

## [1.1.0-beta.5] — 2026-09-08

### Fixed

- Installer now tells unsupported OS/arch clearly: `Your OS "X" is not supported. Spinosa currently supports macOS (Apple Silicon & Intel) and Linux (glibc) on arm64 and x64` instead of a cryptic `Unsupported OS` error (`install.sh`, `distribution/contract.ts`).

## [1.1.0-beta.4] — 2026-09-08

### Fixed

- Failed conversions preserve existing imported output.
- Session deletion failures now propagate to the HTTP error boundary.
- Workspace placeholder updates report accurate change counts.
- Release binaries scrub the known cross-build Cargo metadata path.

## [1.1.0-beta.3] — 2026-09-02

### Changed

- Prompt queue now keeps ordinary prompts editable while a turn runs; explicit steer remains available for interruption.
- Provider, session, stream, TUI, SDK, and tool-runtime paths were split into smaller typed helpers.
- Added release quality, coverage, mutation, generated-data, and binary smoke gates.

### Fixed

- Tool-runtime validation now rejects malformed successful tool output.
- Prompt close and abort paths stop active work cleanly.

## [1.1.0-beta.2] — 2026-08-30

### Removed

- Embedded web UI and `spinosa web` command (opencode legacy, `packages/app` never shipped, server fallback and build embedding removed).

### Changed

- Curated CLI help: only core workflow visible (TUI default + new/add/update/status/list/doctor/providers/models/agent/upgrade/uninstall/stats/version, 14 commands), advanced/debug hidden but still callable via `spinosa <cmd> --help`.
- Large Spinosa ASCII wordmark in CLI help.

### Fixed

- Launch preflight status lines now visible at least 1s each (`checking for updates...` → `no updates available` → `launching TUI...`) before TUI clears screen (was ~20ms).
- Tool-calling compliance + interrupt padding and TUI default/footer Enter vs recent list fixes from `fix/tool-calling-compliance`.

## [1.1.0-beta.1] — 2026-08-08

### Added

- Update lockfile: concurrent installs/upgrades no longer race over `~/.spinosa` version trees (`update-lock.ts`; applies to `update`, `upgrade`, and source installs).
- Workspace create validates folder names (reserved/duplicate names rejected) before scaffolding.
- Import worker payloads are size-capped and batched (E2BIG-safe); OCR conversion runs one image per worker with cleanup.
- Tests for the above (channels, update-lock, worker-payload, classifier rel paths, workspace names, yaml-config).

### Fixed

- **Security:** CORS `allowed-origins` mismatch let hostile local pages bypass the host check (`Vary: Origin` now tracked per request); server sync/directory routes no longer expose hosts outside the sandbox.
- **Security:** internal task-routing bypass (`bypassAgentCheck`) no longer skips agent identity validation except for the matching agent.
- Session prompts default to **queue** delivery (Enter while busy queues instead of dropping); queued prompts get a Steer control.
- TUI no longer kills a running session when switching workspaces; boot overlay can't wedge behind the prompt; SSE rehydration keeps the live session in sync after navigation.
- OCR wedges on multi-page scanned PDFs are retried and skipped individually instead of failing the whole import; classifier and frontmatter handle case-safe relative paths.
- Kernel release channel handling: `beta` install URL and stable channel fallbacks verified live before cut.
- Docs: install instructions point at the live beta channel (stable not yet cut); removed unimplemented `SPINOSA_NO_EMOJI`; agent count corrected to 11; website `/install` redirects to beta.

## [1.0.3-beta.13] — 2026-08-01

### Added

- Home Enter → conversation shows an immediate full-screen **Loading conversation engine…** overlay while the session shell boots (optimistic navigate + background `session.create`); dismisses when the session is synced and the prompt is mounted, with a 30s timeout toast on failure.
- Harness loop-control: turn snapshots + save points, `prepareNextTurn` / `shouldStopAfterTurn` / `beforeToolCall` hooks in the V2 runner, phase→`idle|busy|retry` mapping, optional tool `terminate`, busy rejection for structural ops (model/agent switch, compact), and mid-run `delivery: steer|queue` on the opt-in V2 prompt path (`SPINOSA_SESSION_V2_PROMPT=1`; **TUI chat defaults to V1** `session.prompt`).
- V2 SessionExecution publishes busy/idle onto existing `session.status`; V1 `session.abort` also interrupts V2 execution so ESC/double-ESC keeps working.
- TUI projects `session.next.*` and `permission.v2.*` into the shipped conversation/permission UX (used when V2 prompt is enabled).

### Changed

- **TUI chat defaults to V1** again (`session.prompt` + classic `message.part` transcript). Set `SPINOSA_SESSION_V2_PROMPT=1` to opt into SessionV2 steer/queue. Keeps create-before-navigate, loading overlay, read-path tool rows, workspace-scoped `/session`, and related TUI fixes.
- **Temporary:** TUI research auto-framing is disabled by default (`SPINOSA_SKIP_RESEARCH_PREP`, default on). Enter sends prompts directly to the orchestrator harness (V1/V2 `session.prompt`) instead of `prepareSpinosaSubmit` → Q1–Q5 classify → goal artifact → `executeSpinosaSubmit`. Set `SPINOSA_SKIP_RESEARCH_PREP=0` to restore the research prep layer.
- When V2 prompt is enabled, mid-run prompts **queue by default** (Enter while busy). Queued user messages show a **Steer** control to promote that admission immediately; `<leader>return` / `prompt.submit_queue` also steers the draft. Mini-TUI queued-prompt menu: Return steers (abort active + run next).

### Fixed

- Workspace `/session` list no longer leaks global/unscoped sessions when a Spinosa workspace is selected (directory-scoped filter; `workspaceID === undefined` is not treated as a match).
- V2 write/edit/read tool rows accept `path` as well as legacy `filePath` so writes leave “Preparing write…” and show content; edit maps `files[].patch` → `diff`.
- Home Enter → conversation loading overlay no longer crashes with `ReferenceError: Cannot access 'promptMounted' before initialization` when navigating to a new session (Solid `createMemo` ran before the `promptMounted` signal was declared).
- V2 session history no longer sends empty assistant rows to OpenAI-compatible providers (including DeepSeek): failed turns without replayable output are dropped when building provider context, and Chat Completions lowering omits assistant messages with neither `content` nor `tool_calls` (reasoning-only rows are omitted for DeepSeek).
- OCR import progress in onboarding/add-files shows completed files in green (✓) during the phase: worker `progress` ticks are label-only (no `processing` status), terminal `done` rows are not downgraded, and the live results scrollbox lists succeeded files before the phase hits 100%.
- Startup indexing (`/startup`, queued setup brief after onboarding / startup-choice) always selects the **Orchestrator-Editor** (`build`) agent. A sticky last-used specialist (e.g. `spinosa-overseer` after Tab cycle, or a specialist wrongly registered as primary when `mode: subagent` was missing) no longer hijacks the first indexing prompt. The startup brief no longer matches Q5 coverage heuristics (`coverage` / `gaps` / `overseer` in `startup-prompt.md`), so `ResearchRunService` does not frame indexing as a research run or dispatch `spinosa-overseer` via the harness while the prompt footer still shows Orchestrator-Editor. TUI submit honors `forceAgent: build` directly and skips Spinosa research framing on forced startup paths. TUI default agent resolution prefers `build` over `agents[0]`; kernel `defaultAgent` does the same when `default_agent` is unset. `.opencode/agents/spinosa-writer.md` marks `mode: subagent` so Writer is not cycleable as a primary agent.
- Preflight **Y** on a stale template pack now force-refreshes managed protocol probes (e.g. `.agents/references/classification.md`, overseer agent/skill) and re-checks freshness afterward — previously `replace_if_unmodified` silently skipped nested files with no checksum baseline and still printed success while the pack stayed stale.
- **New workspace** no longer resumes another workspace’s unfinished onboarding: route navigation now replaces store state wholesale (Solid `setStore` was shallow-merging and leaving `workspacePath` / source metadata from a prior Resume → Home path).
- Canceling resume of an incomplete workspace (Esc/Back from onboarding) clears that unfinished active workspace and returns to **global Home** (New/Pick chips) — not workspace-ready Import/Switch/Visualizer. Brand-new create cancel still keeps a ready workspace; add-files cancel is unchanged.
- TUI map-audit (P0–P2): `<leader>q` opens a real queued-prompt manager (Steer) instead of colliding with exit; `/compact` + `/undo`/`/redo` use V2 compact/revert when the V2 prompt path is on (V2 compact implemented); Home chip keys match visible chips; HomeFooter Shift+S/A/P/M/K/D keybinds; workspace picker opens as an overlay (confirm when mid-run) instead of silently abandoning the session route; `<leader>?` toggles tips (frees `<leader>h` for conceal); Update workspace toast clarifies exit-to-rerun; `prompt.submit_queue` / AGENTS route list aligned with Steer + live routes.
- Mid-run V2 prompt (`delivery: steer|queue`) and ESC busy/idle status failed with `InstanceRef not provided` because `SessionExecutionStatusBridge` called instance-scoped `SessionStatus.set` from V2 `/api/session` fibers that lack InstanceRef. Bridge now loads the session directory and binds InstanceRef/WorkspaceRef before publishing busy/idle so steer admission and double-ESC interrupt work again.
- Double-ESC interrupt could stop inference while the conversation spinner kept running: TUI treated transcript-derived “working” (last message is user or incomplete assistant) as busier than an explicit server `session.status: idle` after abort. Server idle is now authoritative when present; transcript fallback applies only when `session_status` is missing (bootstrap/dispose races).
- Home Enter → conversation no longer waits on `prepareSpinosaSubmit`, session sync hydration, or a post-submit timer: seed `session.create` into the sync store, navigate immediately, then prepare/admit the prompt in the background so the chat prompt activates without waiting for SSE/`sync.session.sync`.
- Workspace-ready Home Enter no longer waits on `session.create` (Spinosa workspace instance bootstrap): seed an optimistic session with a client-generated id, navigate immediately, then create/prepare/admit in the background.
- Connect-a-provider dialog was empty (only “Other / Custom provider”) because V2 `SessionExecutionStatusBridge` used the wrong LayerNode tag, crashing app bootstrap with `Cannot replace @spinosa/v2/SessionExecutionStatus across tags`. Bridge now uses `makeGlobalNode` so serve/TUI start and the provider catalog loads again.
- Workspace template / agent protocol: startup indexing never dispatches `spinosa-overseer` or `agent-interception`; overseer refuses while `setup_status: cli_started` and prefers in-workspace coverage analysis (soft-fail without external sessions). Aligned extraction naming to `extraction_{batch_id}.md`, startup serendipity to `NN_startup-serendipity-*.md`, map writing to mapper `map_write`, startup-mode AGENTS/CLAUDE overrides (no question tool, no 120s mapper timeout, host-default model), classification Q0, add-files prompt (no full startup re-run), and removed `systematic-bugfinder` from end-user workspace template packaging.
- Detect stale workspace template packs by comparing protocol probe files (not only `framework_version`). Launch preflight offers a terminal **Y/n** to update stale packs before the TUI starts (target workspace if opening one, otherwise registered present/legacy workspaces); skipped when non-interactive (`CI`, no TTY, `SPINOSA_NO_UPGRADE_CHECK`). TUI Update workspace remains a secondary path (then exits and asks you to re-run `spinosa`); `startup-prompt.md` updates preserve the onboarding metadata footer; `spinosa doctor` reports pack staleness.

## [1.0.3-beta.12] — 2026-08-01

### Added

- Home Recent list shows total count when more workspaces exist than the compact/normal cap (overflow opens via **Pick a workspace**); load failures show an inline error instead of a silent empty list; recent rows include a muted truncated path under the name.
- Workspace picker **Manage N stale** opens a per-row stale manager (× / ⌕ / → glyphs for delete / scan / path) instead of bulk-delete-only; Scan/Path reuse the lost-workspace recovery dialog, Esc nests back through recover → manage → picker, and bulk “delete all” remains a secondary two-step action (failed paths are named).
- Lost-workspace recovery UX: home Recent list surfaces missing index entries; the recovery dialog offers **remove from index**, **provide new path**, or a **privacy-first local scan** (shows roots first, cancelable, marker/ID match only; ambiguous hits let you pick a path).
- Process-local **JobRunner** control plane for Spinosa domain jobs: start → progress → **cancel-by-id** (kills child processes) → done/error. Import and research share the same cancel path; sessions stay on the SDK. GlobalBus job events remain observational; cancel authority is process-local.
- Import **processor registry** (`direct` / `markitdown` / `ocr`) so wizards run phases through one protocol with shared abort and child registration.
- MarkItDown NDJSON child (`spinosa internal markitdown-worker`) with the same cancel-kill protocol as OCR; nested OCR fallback shares the child process group.
- Shared `runImportWorkflow` drives onboarding and add-files import phases through one registry path.
- Research and home “Repair dependencies” use `createImportJob` lifecycle events (`started` / `finished` / cancel-by-id).

### Changed

- Home global actions: open-workspace chip reads **Pick a workspace** (was “Choose a workspace”); Recent no longer shows a **Show all** overflow control beside the list.

### Fixed

- Handoff clipboard on Linux prefers `wl-copy` when `WAYLAND_DISPLAY` is set (then `xclip` / `xsel`), matching TUI clipboard selection; Darwin still uses `pbcopy`.
- Linux Bun `--compile`: embed + stage `@napi-rs/canvas` skia `.node` and set `NAPI_RS_NATIVE_LIBRARY_PATH` before OCR/canvas loads. Nested `ppu-ocv` chunks could not `require()` optional `@napi-rs/canvas-linux-*` (doctor Canvas OK, OCR missing); Darwin unchanged.
- ONNX companion libs: on Linux, stage under `$SPINOSA_HOME/cache/onnx-runtime` when writable+executable (then XDG `spinosa/`), else `os.tmpdir()`; on Darwin, prefer `os.tmpdir()` first for `@rpath` adjacency. The stage directory is always prepended to `LD_LIBRARY_PATH` / `DYLD_LIBRARY_PATH` so off-tmpdir staging still loads (helps Linux `noexec` tmp).
- Installer and binary target resolver refuse musl/Alpine early (need glibc Linux or macOS) before download.
- Lost-workspace recovery on Linux also searches `/run/media` (alongside `/mnt` and `/media`).
- Onboarding **Scan source folders** activates on Enter (same as click), matching add-files and the gate-button Enter pattern.
- `.pptx` is no longer listed as MarkItDown-supported: markitdown-ts rejects PowerPoint, so classification / scan toggles / docs treat it as unsupported.
- Manage stale dialog keeps fixed Name / Path / Status / Actions columns (no smashed one-liners), uses compact × ⌕ → action glyphs with hover on one line (Actions no longer wraps), and a fixed-height scrollbox so the window no longer resizes with row count.
- Research jobs publish onto the GlobalBus / in-process event emitter (same path as import) for cancel/observability; framed research no longer toasts route · goal · run id or shows a session footer job strip.
- `@` file autocomplete distinguishes search failures from empty results (`Couldn’t search files: …` instead of a false “No matching items”).
- Workspace update and session-create failures show the real error in the toast (and update also opens a small alert); update phase labels are no longer truncated to 22 characters.
- `openWorkspace` soft-fails (missing/invalid presence, unreadable metadata) toast the path + reason and offer **Recover** / **Choose another** instead of silently reopening the picker; identity mismatch still logs and proceeds. Home maintenance lists stale install/temp paths (confirm dialog + preview), keeps a one-line cue in compact layout, and explains when runtime repair can’t run because the bundled version is unknown.
- TUI toasts anchor to the terminal top-right (viewport size), not the centered content column.
- Cancel / “Stop and go back” no longer navigates away when the soft abort wait times out while import work is still running; the stop overlay stays up (“Still stopping… Esc to leave anyway”) until the job settles or the user force-leaves.
- Import progress phase complete / recap waits for pending file statuses to settle (`queued`/`processing`) instead of flipping to the 100% recap on `current >= total` alone; counter-only fallback no longer invents `failed: 0`.
- Import wizards finish the job as `error` (not `completed`) when any files failed (`completed|error` only).
- Add-files MarkItDown/OCR gates run before advancing the step chrome (matches onboarding), so the next phase label does not overlay the previous phase’s 100% recap.
- Onboarding verify/done keeps the last-phase ProgressBar file list visible (no longer clears `progressFiles`); shows summary + `_failed_files/` cue; uses warning/error accents when `failedCount` / `stillMissing` > 0 instead of always painting success green. Failure/gap done chrome points at `~/.spinosa/logs/` instead of dumping the full wizard log (diag / MarkItDown / PPU steps); verbose lines are still flushed to `tui.ndjson`.
- OCR `afterPhase` dwells before verify/done so failure-first 100% results are readable; add-files done step keeps the results ProgressBar.
- Mid-phase failed file list uses the same scrollbox as the complete results list (no `slice(0,6)` + “… +N more”).
- OCR import progress no longer double-counts: worker progress updates the live filename only; the bar numerator advances on completed files (`done`/`failed`), never reverts a terminal status to `processing`.
- OCR conversion failures (runtime, crash, MD→OCR fallback) count as **failed**, not skipped. Skipped remains only for already-converted / pre-skip cases.
- Cancel during OCR/MarkItDown no longer races child `close` into a crash path: if abort was already requested, the wait finishes as cancelled and MarkItDown throws `SpinosaCancellationError` instead of returning a partial success.
- Installer activation gates fail closed: staged template ensure/verify and doctor must pass before activating a binary (no soft-continue).
- `script/patch-local-install.sh` refuses binary-distribution installs so it cannot overwrite `~/.spinosa/bin/spinosa` with a source forwarder.
- Startup maintenance probes `.staging/.install.lock` (with legacy `versions/.install.lock` fallback) so autoclean does not race an active binary install.
- Doctor no longer always reports MarkItDown available in binary mode; OCR is not claimed available from a staged onnxruntime library alone.
- Startup autoclean JSON/`removed` reporting uses actual `removedDirectories`, not candidate-only counts.
- TUI hover/keyboard integrity: import “All supported files” row and shared confirm/alert buttons keep readable contrast via `buttonText`/`buttonBackground`; home Recent workspaces respond to ↑↓/Enter; Esc on confirm settles as cancel.
- Copy and MarkItDown import progress now emit per-file start/done events (with event-loop yields) so the TUI bar steps file-by-file like OCR, instead of jumping to 100% after a lag.
- Cancel / “Stop and go back” keeps the **Stopping process, exit cleanly, wait** overlay visible for ~3s even when cancel is instantaneous, so the transition remains readable.
- OCR cancel no longer waits for the full batch: abort kills the detached OCR child (SIGTERM → SIGKILL) and the OCR child hard-exits on SIGTERM/SIGINT.
- Dead `activeChild` kill path in add-files removed; cancel goes through JobRunner + `registerChild`.
- Sync bootstrap failures degrade to partial status instead of hard-exiting the TUI by default.
- Session worker no longer hard-exits on `unhandledRejection` (log only); `uncaughtException` still exits. Import/OCR already isolate failures in parent children.
- Workspace artifact watcher prefers `fs.watch` and polls less often when watches are active.
- Additional dialogs read Solid resources via `safeResourceValue` to avoid ENOENT/render aborts.
- Processor registry `overwrite` flag correctly wired into direct copy (was miswired as unused `copyFn`).
- Startup maintenance also removes stale OS temp leftovers (`spinosa-launch-*`, `spinosa-upgrade-*`, `spinosa-install.*`, failed `.extracting-*` template stages) older than 1h; dormant `~/.spinosa/versions/*` trees are reported but never auto-deleted.
- CLI handoff launch scripts clean the whole temp directory on exit (not just the script/prompt files).
- Import progress events may carry optional per-file `status` (`queued` / `processing` / `done` / `failed` / `error`); the wizard progress panel shows short filenames, a live 4-file queue with status accents, and a red failed list. When a phase hits 100%, the panel hides the live “› filename” line and shows a one-line recap (`N copied/converted/processed · M failed`) plus a scrollable green/red results list (failures first, all files, ~12-row max height) instead of the queue or hard “… +N more” truncation.

### Changed

- **linux-x64 product binary ships without OCR**: `spinosa-linux-x64` does not stage/load onnxruntime or force-import `ppu-paddle-ocr` at boot. Doctor reports OCR as **unsupported** (does not fail closed / block installer activation). Import wizards skip OCR; MarkItDown / PDF / direct still work. Darwin and linux-arm64 keep OCR as today.
- Import verify/done (and add-files done) with failures no longer dumps the full wizard LogScrollbox; shows a one-line `Details saved in ~/.spinosa/logs/` pointer instead (verbose lines flushed to `tui.ndjson`). Mid-verify keeps a compact status line only.
- OCR models still load once per OCR child, only when an OCR job starts (not at TUI boot).
- MarkItDown conversion runs out-of-process by default (same isolation model as OCR).

### Added

- MarkItDown now runs in an NDJSON child (`spinosa internal markitdown-worker` / `markitdown-worker.ts`) with the same cancel-kill protocol as OCR; nested OCR fallback shares the child process group.
- Shared `runImportWorkflow` drives onboarding and add-files import phases through one registry path.
- Research and home “Repair dependencies” use `createImportJob` lifecycle events (`started` / `finished` / cancel-by-id).

## [1.0.3-beta.11] — 2026-07-31

### Fixed

- PDF viewer polyfills canvas globals (`ImageData`, `Path2D`, DOMMatrix) from the ESM `@napi-rs/canvas` entry so pdfjs render works in the product binary without relying on optional CJS probes.
- Markdown viewer shows a clear missing-file state instead of aborting when a path is gone or unreadable.
- TUI resource reads harden against `ENOENT` so missing companion files do not crash the session.

## [1.0.3-beta.10] — 2026-07-31

### Breaking

- Product distribution is **binary-only**. Releases publish four platform executables (`spinosa-darwin-arm64`, `spinosa-darwin-x64`, `spinosa-linux-arm64`, `spinosa-linux-x64`), `install.sh`, `checksums.txt`, and `build-manifest.json`. The `spinosa-v*.tar.gz` source product archive is no longer published.
- End-user installs no longer download Bun, run `bun install`, link OpenTUI packages, or stage `~/.spinosa/versions/<version>` source trees. The active runtime is `~/.spinosa/bin/spinosa` with embedded workspace templates extracted under `~/.spinosa/templates/`.
- Workspace `.bin/spinosa` is a minimal forwarder to the installed binary. Managed source launchers are migrated; user-modified launchers are preserved.

### Changed

- Installer performs checksum-verified download, staged verification (`version` / template ensure / doctor), atomic activation, and rollback. `SPINOSA_RELEASE_BASE_URL` overrides the asset base for local smoke.
- Upgrade, launch preflight, repair, and uninstall no longer treat `~/.spinosa/versions` as the active runtime. Legacy version trees are left dormant and are never auto-deleted; metadata and registered workspaces are preserved.
- Release pipeline builds product binaries via `script/build-release-binaries.ts` (shared `buildSpinosaBinaries`) and smokes the real installer against local HTTP assets.
- `--no-bundled-tools` is a deprecated no-op warning during the transition beta.

### Migration

- Re-run the beta/stable `install.sh` once. Owned metadata and workspace registrations remain. Dormant `versions/` may be removed later with an explicit cleanup option after the binary install is healthy.

## [1.0.3-beta.9] — 2026-07-31

### Fixed

- Installer repair is unified: one **Installation needs repair** / **Repair now? [Y/n]** path for virgin debris, incomplete homes, and dependency recovery (`--yes` / `SPINOSA_REPAIR=1` auto-accept). Logging no longer writes under `~/.spinosa` before preflight, so a missing `unzip` cannot leave blocking debris.
- Virgin “repair” never wipes `SPINOSA_HOME`: only an allowlisted set of debris paths (`logs`, `env.sh`, `bin`, `lib`, `metadata`, `versions`) may be removed, each behind ownership / complete-version / reclaimable guards. The home directory itself is never deleted.

## [1.0.3-beta.8] — 2026-07-31

### Changed

- Release archive smoke is **full by default** (`bun install --frozen-lockfile` + launch inside the built tarball). Cuts cannot publish if the archive would fail for upgraders. Structure-only is opt-out via `SPINOSA_SMOKE_STRUCTURE=1` (local only).

### Fixed

- When dependency install fails (e.g. lockfile mismatch), the installer says **Installation needs repair** and offers **Repair now? [Y/n]**. `--yes` / `SPINOSA_REPAIR=1` auto-repair with a non-frozen `bun install` so upgraders are not stuck.

## [1.0.3-beta.7] — 2026-07-31

### Fixed

- Release bump refreshes and commits `bun.lock` after version sync so `bun install --frozen-lockfile` works for published archives (beta.6 install failed with “lockfile had changes”).
- `bun run quality` asserts `bun install --frozen-lockfile` before shipping.

## [1.0.3-beta.6] — 2026-07-31

### Added

- Fast local release quality gate: `bun run quality` → `script/quality-release.ts` (two parallel waves: product typechecks + light checks, then launch/workspace regressions). Deep sweep remains `bun run quality:full`.
- Explicit republish path: `bun run release:republish -- vX.Y.Z` (replaces `script/release.sh`).
- `bun script/generate-patches-md.ts` regenerates `patches/PATCHES.md` from `patchedDependencies` and fails when patch rationale headers are missing.
- Workspace create seeds `.spinosa/framework-checksums.json` so managed agent/config dirs can refresh on later updates without `--force`.
- Release `smoke` stage + `script/smoke-install.ts`: default repo smoke; archive mode is structure-only unless `--full` / `SPINOSA_SMOKE_FULL=1`.
- Patch files document Why / Upstream / Owner / Remove-when headers.

### Changed

- Workspace creation copies only paths declared in `workspace-files.tsv`, not the full template tree.
- Launch preflight runs before the TUI worker spawns; the artificial 1-second status delay is removed.
- Upgrade version cache simplified to a two-line timestamp + version file with a one-hour TTL.
- Typecheck across packages now uses `tsc --noEmit` instead of `tsgo`.
- Document converter dependencies (`markitdown-ts`, `pdfjs-dist`, `ppu-paddle-ocr`, `@napi-rs/canvas`) owned by `@spinosa/core` only — removed from `@spinosa/tui`.
- `bun run dev` entrypoint (`packages/spinosa-cli`) now declares `@spinosa/core` as a dependency.
- Privacy and development documentation updated to describe local-first behavior with optional cloud model providers.
- Installer dependency install uses `bun install --frozen-lockfile` (no `--force` rewrite path).
- Release orchestrator: `beta`/`stable` must run from `beta`/`main`; release state SHA updates after bump; `git archive` uses that SHA; version tags must match HEAD; immutable version assets are not clobbered when checksums differ.
- Workspace-template docs and glossary use PaddleOCR / `ppu-paddle-ocr` (RapidOCR references removed).
- README install section documents stable, beta, and immutable version URLs without presenting beta as the only channel.
- Release sign-off checklist matches the 3+2 asset model and the `bun run release` orchestrator.

### Removed

- GitHub Actions quality workflow (`.github/workflows/quality.yml`). Release validation is local only: `bun run release:validate` → `bun run quality`.
- Orphan `patches/solid-js@1.9.10.patch` (not in `patchedDependencies`).
- Framework update recursive “contaminant” cleanup by extension (`*.jsonl`, `*.bak`, `*ocr-processed*`, `raw/*.log`). Updates no longer scavenge the corpus; orphan retirement is limited to managed framework directories (and known Pilosa names).

### Fixed

- `truncateDestPath()` preserves path roots and handles UTF-8 byte limits correctly.
- Framework discovery no longer falls back to a hardcoded maintainer machine path.
- Shellcheck passes on `install.sh` (legacy shim detection uses explicit disable comments).
- `bun install` catalog entry for `@effect/platform-node-shared` restored.
- Workspace update archives retired Pilosa agent files under managed dirs while leaving legitimate user files (including corpus `.jsonl` / `.bak`) in place.

## [1.0.3-beta.5] — 2026-07-31

### Fixed

- Installer/launcher now link `@opentui/{solid,core,keymap}` into the framework root after `bun install`. The launch argv uses `bun --cwd <root> --preload @opentui/solid/preload`, but Bun only installs `@opentui` under workspace packages — clean VMs failed preload / `runtime_healthy` until manual symlinks. Install validation now uses the same argv as `exec_kernel`.

## [1.0.3-beta.4] — 2026-07-30

### Fixed

- TUI opens the caller project when the launcher uses `bun --cwd` on the install/framework root: `resolveThreadDirectory` prefers `PWD` for framework cwd so the session lands in the user project.
- `/connect-family`: keep session status and provider catalog live without dispose wipe on connect; shared session busy fallback; org-switch clear-first with busy guard and call-site bootstrap; single-flight bootstrap; `catalog.updated` refreshes providers; CLI providers reload.

## [1.0.3-beta.3] — 2026-07-30

### Fixed

- Installed `spinosa` launcher loads OpenTUI Solid via `bun --cwd <root> --preload @opentui/solid/preload <entry>` so the TUI renders from any project directory (was a blank black screen).
- Shared `buildKernelBunArgv` / bash `exec_kernel` launch helper rejects the broken `bun --preload … run …` argv that dumped Bun's help menu instead of starting Spinosa.

## [1.0.3-beta.2] — 2026-07-30

### Changed

- Settings writes real `auto_upgrade` in `~/.spinosa/metadata/config.yaml` (removed unused `autoupdate` / skipped-version theater).
- Product identity leftovers rebranded to Spinosa; OpenCode Zen and OpenCode Go providers kept as-is.
- Worktree branch prefix is `spinosa/` instead of `opencode/`.
- Local patch installer also installs the user-facing shim into `SPINOSA_BIN_DIR` (default `~/.local/bin`).

### Removed

- `spinosa github` and `spinosa acp` from the product CLI (quarantined under `script/orphan/`).
- Fake tips for github install, `/review`, and related OpenCode leftovers.

### Fixed

- TUI picker Escape restores the previous route; failed workspace opens roll back path/KV.
- Skills and docs use `spinosa export` (no unsupported `--session`/`--last`).
- Stable channel UI notes that the rolling channel may be unavailable until published.
- `spinosa uninstall` now exits with an error for a non-Spinosa `SPINOSA_HOME` instead of treating it as success.

## [1.0.3-beta.1] — 2026-07-30

### Changed

- Release pipeline is the custom TypeScript orchestrator in `script/release/` (not release-it). Stages: preflight → bump → build → verify-local → git-tag → publish-version → channel → verify-remote.
- `script/set-version.ts` syncs root `package.json`, `install.sh`, and Spinosa product packages (`spinosa-core`, `spinosa-cli`, `spinosa-harness`, `spinosa-runtime`) to the product version. Kernel/TUI keep their upstream 1.17.x fork versions.
- Release preflight/bump require a `CHANGELOG.md` section heading for the version being released.
- Orphan publish/build scripts (`build-tui`, `publish-tui`, `verify-release.sh`, per-package npm `publish.ts`) moved to `script/orphan/` — do not run during release.

### Fixed

- Stale product package versions (1.0.2-beta.2) brought in sync with root `1.0.3-beta.1`.
- Maintainer docs corrected to name real `script/release/` stages instead of release-it / `publish-channel` / `release:verify-remote`.

## [1.0.2-beta.15] — 2026-07-30

### Changed

- Launch preflight is unified in the kernel TUI. `spinosa` and `bun run dev` use the same path. Both print `checking for updates...`, `no updates available` (1 second minimum), then `launching TUI...`.
- Upgrade engine, launch preflight, and version sync are consolidated in `@spinosa/core`. The bash launcher no longer runs a separate preflight subprocess.
- Release docs rewritten: `RELEASE_GUIDE.md` documents the custom TypeScript orchestrator in `script/release/`, `script/set-version.ts`, and rolling channel publish steps. Maintainer docs updated in `CONTRIBUTING.md`, `workspace-template/docs/reference/cli.md`, and the website CLI reference.

### Fixed

- `bun run dev` now runs the same upgrade check as `spinosa` when root `package.json` has a product version.
- After a launch-time upgrade, `spinosa-cli` and the bash launcher re-exec on exit code `10`.
- Release validation runs GitHub helper tests outside the root `bunfig` guard.

## [1.0.2-beta.2] — 2026-07-28

### Fixed

- The TUI launch path (`spinosa` with no arguments) referenced a deleted `packages/opencode` directory, causing "Spinosa not found" on fresh installs. The entry point now launches from `packages/tui/src/spinosa-cli.ts`.

## [1.0.2-beta.1] — 2026-07-28

### Security

- Local logs (`spinosa.log`, `tui.ndjson`, `debug.ndjson`) and the workspace registry are now written with `0600` permissions; parent directories use `0700`. Sensitive keys (`authorization`, `cookie`, `password`, `secret`, `token`, `api_key`) are redacted from log entries, and `Basic`/`Bearer` credentials are scrubbed from log text.
- The HTTP API no longer accepts credentials via the `auth_token` query parameter. Use the `Authorization` header instead. Query credentials are now rejected with `401`.
- The local server now refuses to bind to non-loopback hosts unless `SPINOSA_SERVER_PASSWORD` is set. Binding to `0.0.0.0` without a password throws at startup.
- The remote UI proxy (`app.opencode.ai`) has been removed. The server serves the embedded UI only; when the embedded UI is unavailable, requests fall through to the local 404 handler. The Content-Security-Policy is tightened (`connect-src 'self'`, `base-uri 'none'`, `object-src 'none'`, `frame-src 'none'`, `form-action 'self'`).
- The reverse proxy sanitizer now strips `authorization`, `cookie`, `origin`, and `referer` headers before forwarding requests; target-specific credentials may still be supplied explicitly via `extra`.
- The Homebrew tap publish step no longer embeds the GitHub token in the clone URL. It uses a `GIT_ASKPASS` helper with the `GITHUB_TOKEN` environment variable instead.
- The migration report now stores relative paths instead of absolute paths, and is written with `0600` permissions.

### Changed

- Dependencies bumped: esbuild `0.25.12` → `0.28.1`, `solid-js` `1.9.10` → `1.9.14`, `vite` `7.1.4` → `7.3.5`, `dompurify` `3.3.1` → `3.4.12`, `@babel/core` `7.28.4` → `7.29.6`, `minimatch` `10.0.3` → `10.2.5`, OpenTelemetry packages to `2.10.0`/`1.9.1`/`0.221.0`.
- `.gitignore` now excludes `packages/spinosa-kernel/.spinosa-migration-report.json`, `.serena/`, and `*.tsbuildinfo`.

## [1.0.1-beta.14] — 2026-07-24

No user-facing changes since beta.13. (Build pipeline stabilization.)

## [1.0.1-beta.13] — 2026-07-23

No user-facing changes since beta.12. (Tag cleanup.)

## [1.0.1-beta.12] — 2026-07-23

### Changed

- TrOCR engine and LLM‑based OCR post‑processing removed. `ppu-paddle-ocr` remains the sole OCR engine. All `trocr` references purged from worker and pipeline code.

## [1.0.1-beta.11] — 2026-07-23

### Fixed

- All upgrade awareness removed from the TUI. Upgrade prompting, downloading, and installation now live exclusively in `spinosa upgrade` (CLI). The TUI never mentions or offers upgrades.
- Post‑upgrade workspace discovery shows a progress message.

## [1.0.1-beta.10] — 2026-07-23

### Fixed

- Version check no longer caches the "upgrade available" decision. Every TUI mount re‑fetches the remote version so the upgrade prompt appears reliably when a newer release is published.

## [1.0.1-beta.9] — 2026-07-23

### Fixed

- After `spinosa upgrade` completes, the user is now prompted to update their workspaces from within the same CLI flow. TUI flow unified: both CLI‑only and TUI‑assisted upgrades offer the same post‑upgrade workspace update step.

## [1.0.1-beta.8] — 2026-07-23

### Fixed

- Better error logging when upgrade version resolution fails.

## [1.0.1-beta.7] — 2026-07-23

### Fixed

- `spinosa upgrade` no longer crashes when a registered workspace directory is missing during the post‑upgrade update phase.

## [1.0.1-beta.6] — 2026-07-23

### Fixed

- Old version directories are purged from `~/.spinosa/versions/` after a successful upgrade.
- Known contaminant files (leaked test artifacts, personal paths) are cleaned during workspace update.

## [1.0.1-beta.5] — 2026-07-22

### Added

- Dedicated upgrade screen that blocks the home page until the upgrade is resolved.
- Scrolling ASCII banner handles long workspace names.

### Fixed

- ASCII art always shows; removed the scrolling animation that sometimes hid the banner.
- OCR runs in an isolated child process; ANSI escape sequences stripped from OCR output.
- Test fixture paths anonymized.

## [1.0.1-beta.4] — 2026-07-22

### Changed

- Remaining personal paths stripped from website, server, and installer artifacts. Leak‑prevention patterns added to `.gitignore` and `raw/AGENTS.md`.

## [1.0.1-beta.1] — 2026-07-22

### Added

- Installer now uses the TUI wave pattern (`tui-wave`) for visual consistency.
- First post‑stable beta release.

### Fixed

- Legacy Spinosa shim recognized correctly.
- Beta checksum manifest validation fixed.
- Stale `corpus.md` removed (replaced by `workspace.md`).

## [1.0.0] — 2026-07-20

### Added

- First stable release. All changes from the beta series are now promoted to stable.
- Spinosa checks for updates on every start and prompts to upgrade when a newer version is available.
- Workspace picker "Delete stale" button removes non‑existent workspace index entries.
- `spinosa upgrade` now prompts for confirmation before installing.
- Website moved into repo at `website/` — deployed to GitHub Pages on push to `main`.

### Changed

- Repository migrated from `TommasoPrinetti/spinosa` to `medialab/spinosa`.

### Fixed

- `bun run dev` from outside a workspace no longer auto‑opens the last saved workspace.
- Workspace index cleaned of 108 stale e2e test entries.

## [0.9.0-beta.27] — 2026-07-20

### Fixed

- `spinosa upgrade` now prompts `[Y/n]` before proceeding. Use `--yes` to skip confirmation.

## [0.9.0-beta.26] — 2026-07-20

### Added

- Upgrade prompt now offers "Yes" to install the update immediately, then exits TUI with a message to re-run spinosa.

## [0.9.0-beta.25] — 2026-07-20

### Added

- Spinosa now checks for updates on every start. "Checking for updates…" appears in the boot loading screen. If a newer version is available, a dialog prompts the user to run `spinosa upgrade`.

## [0.9.0-beta.24] — 2026-07-18

### Added

- `@spinosa/tui-agent` — deterministic OpenTUI driver for agent-operated TUI debugging. Ships as a npm-packable package with a CLI (`tui-agent run`, `interact`, `list`, `show`, `diff`, `doctor`), JSON scenario DSL, JSONL agent control loop, artifact output (text, SVG, spans, tree, state), and a Spinosa adapter example. See `packages/tui/tools/tui-agent/README.md`.
- `/session` command alias for `/sessions` in the TUI command palette.
- HomeFooter keyboard labels (Shift+S/A/K/W/M) are now wired to actual key bindings via `useBindings`.
- Workspace picker: "Delete stale" button removes all non‑existent workspace index entries in one click, with confirmation dialog.

### Changed

- `/session` command now scopes to the active Spinosa workspace path instead of the TUI host directory. Sessions created in workspace B from a TUI launched in workspace A are visible when switching to workspace B.
- HTTP API `session.list` now accepts a `workspaceID` filter parameter.

### Fixed

- HomeFooter `onMouseDown` changed to `onMouseUp` so click-outside-to-dismiss on dialogs does not also fire footer actions.
- Dialog backdrop now correctly distinguishes backdrop clicks from inner-dialog clicks via a `backdropPressed` flag and `stopPropagation`.
- Dialog max height is now responsive to terminal height: smaller than 30 rows gets `height - 2`, otherwise 60% of terminal height.
- Dialog, dialog-select, and dialog-export-options use `flexDirection="column"` and `minHeight={0}` so content shrinks inside small modals.
- Session list scrolls inside small modals (`minHeight={0}` boundary before prompt/footer).
- Export options layout is columnar on narrow terminals; labels and options no longer render across one row.
- Workspace picker columns (Name, Parent, Status, Version, Accessed) are now responsive — hide Version below 72 columns, hide Accessed below 94 columns.
- Workspace picker adds a `›` selection indicator, uses `compactColumns()` for narrower terminal widths.
- Home reduces decorative chrome below 24 terminal rows (hides spacer, version label, ASCII banner, limits recent cards to 1).
- ASCII banner falls back to bold plain text when the terminal is too narrow for the `block` font rendering.
- Visualizer hides the stacked inspector when terminal height is below 28 rows.
- Visualizer hides keyboard shortcut hint bar below 28 rows.
- Prompt workspace status bar uses `overflow="hidden"` and shows a separator pipe below 80 columns.
- Session transcript scroll container has `minHeight={0}` to prevent overflow in constrained layouts.
- DialogProvider wraps dialog overlay with a positioned `box` instead of layering the overlay over the entire screen, preventing obscure mouse-targeting issues.
- `bun run dev` from outside a Spinosa workspace no longer auto‑opens the last saved workspace. Shows global home instead.
- Cleaned 108 stale e2e‑test workspace entries from the global registry.

## [0.9.0-beta.22] — 2026-07-17

### Fixed

- TUI now lands on the global homepage (workspace picker) instead of auto-opening the last-used workspace
- Resolved 14 pre-existing TypeScript errors: missing `inspectWorkspacePresence` import, `createResource` type inference in `dialog-move-session`, and read-only `Breakpoints` mutation in `anthropic-messages`
- Framework root resolution now prefers the installed release over the dev repo (`spinosa-main`) so workspace creation doesn't stamp with the wrong version
- Removed stale serena MCP plugin config

## [0.9.0-beta.21] — 2026-07-17

### Fixed

- macOS 26.5 security scanning (XProtect/Gatekeeper) would SIGKILL the bun process on first `spinosa` invocation after install because native `.node`/`.dylib` addons carry a kernel-protected `com.apple.provenance` xattr. The installer now runs a warm-up `bun run ... version` (with retries) after dependency install to let the scanner complete before the verify step, and the verify step itself retries up to 3 times with a 2-second pause. Spurious `Killed: 9` should no longer appear.

- The `spinosa: true` marker is now written to `metadata/config.yaml`, fixing the uninstall command's "marker missing" error.

- Cleaned up duplicate Spinosa PATH entries in `.zshrc` and removed a stale `/tmp/spinosa-test-*` reference.

## [0.9.0-beta.20] — 2026-07-17

### Fixed

- Installer no longer auto-launches the Spinosa dashboard. Auto-launching an interactive TUI from a `curl | bash` pipe is unreliable (no controlling TTY, orphaned background jobs killed with SIGKILL), which caused the installer to report a spurious `Killed: 9` and left `spinosa` dead on subsequent runs. The installer now only installs and prints `→ Run Spinosa with: spinosa`; the user launches the dashboard themselves in a fresh terminal. The runnability probe now uses the non-TUI `spinosa version` instead of `help`.

## [0.9.0-beta.19] — 2026-07-17

### Fixed

- Installer now terminates after a successful install instead of hanging: the Spinosa dashboard is launched detached in the background (`nohup ... &`), so the installer process exits cleanly while the dashboard keeps running.

### Changed

- Installer output is now grouped into labelled sections (System check, Download & extract, Dependencies, Install & configure, Verify) and every user-visible line carries a consistent status glyph (`→` step, `✦` success, `⚠` warning, `↳` note, `✗` error, `?` prompt), making progress easier to follow at a glance.

## [0.9.0-beta.18] — 2026-07-17

### Fixed

- Installer no longer fails with "Dependency timeout runner not found" during `bun install`. The dependency watchdog (`run-with-timeout.ts`) was previously excluded from the GitHub source tarball by a `.gitattributes` `export-ignore` rule on `script/`. It now ships under `workspace-template/.bin/` so fresh installs and upgrades can run `bun i` correctly.

## [0.9.0-beta.17] — 2026-07-17

### Fixed

- Installer now shows progress spinners and status messages for every long-running step (download, extraction, bundled Bun fetch/extract, staging, promotion) so the user is never left staring at a silent terminal.
- Installer no longer appends a duplicate PATH block to shell config files on re-run; it detects the existing Spinosa marker correctly.
- Archive safety check no longer mis-computes symlink traversal depth, so legitimate nested symlinks are accepted while escaping symlinks are still rejected.
- Repair of a broken global `~/.spinosa` home is guarded so a missing/empty `SPINOSA_HOME` can never resolve a destructive `rm -rf` to `/bin` or `/lib`.
- Dashboard launch failure is reported with a hint to run `spinosa` manually instead of silently exiting.

### Changed

- Version comparison during upgrade detection uses an explicit exit-status capture, avoiding a stale comparison result on equal versions.

## [0.9.0-beta.16] — 2026-07-17

### Added

- Workspaces now have persistent unique IDs and richer global registry metadata for presence, setup state, recovery, and moved-folder detection.
- Startup now performs visible cleanup, identity, and workspace-presence checks before opening the TUI.
- Missing workspaces can be relocated manually, found by scanning for their ID, or removed from the registry directly from the picker.
- Interrupted workspace imports can resume from their saved source and workspace metadata.

### Changed

- Recent workspaces exclude missing entries, label incomplete imports, and route incomplete workspaces back into onboarding at the appropriate step.
- Back navigation during copy, OCR, MarkItDown, and other active import work now confirms cancellation and stops the process before navigating.
- Installer maintenance repairs damaged runtime dependencies while preserving central Spinosa metadata.

### Fixed

- WASM-only shell parser dependencies no longer invoke native `node-gyp`/Python builds during installation; dependency attempts now stream output and time out cleanly before repair.
- Linux terminals no longer retain stale bold styling when reactive text attributes change.
- TypeScript CLI commands such as uninstall preserve interactive terminal input.
- Global-home workspace actions render after leaving an incomplete import.
- Removing a missing workspace now refreshes the open picker before returning to its workspace list.

## [0.9.0-beta.13] — 2026-07-14

### Added

- The first-run global home now requires provider selection before creating or opening a workspace.
- The visualizer now supports session and workspace selection, multiple visualization modes, clickable tool details, and copyable tool commands.

### Changed

- Visualizer controls, hover states, scrolling, spacing, tool colors, and canvas top alignment now follow the TUI layout conventions.

### Fixed

- TUI release tests now track current home navigation, routing, versioning, and update-lock behavior without leaking module mocks across test files.

## [0.9.0-beta.9] — 2026-07-12

### Changed

- Upgrade checks now run in the CLI before the TUI starts. Successful upgrades optionally update every registered workspace, then request a fresh `spinosa` launch so the new runtime is loaded.
- Removed upgrade networking and installer ownership from the TUI home screen.

### Fixed

- Global output flags now work before commands, for example `spinosa --json status`.
- `spinosa status [workspace]` now honors positional workspace paths and rejects explicitly invalid workspaces.
- Human CLI summaries now use the configured output channel instead of leaking directly to process stdout.

## [0.9.0-beta.8] — 2026-07-12

### Fixed

- `spinosa upgrade` now verifies the newly installed target release instead of the still-running previous release, preventing successful upgrades from being reported as failures.
- Maintenance checks now import the Node `Dirent` type from its correct module, restoring clean Spinosa typechecks.

## [0.8.0-beta.16] — 2026-07-08

### Fixed

- `replace_if_unmodified` update policy now actually enforced: user-modified framework files are skipped during `spinosa update` via SHA-256 checksum tracking.
- `spinosa uninstall` confirm prompt no longer has a 100ms delay on macOS bash 3.2.

### Changed

- Version cache now skips re-checking for 1 hour when no upgrade is available, reducing GitHub fetches on repeated TUI home mounts.
- TUI upgrade flow now shows a toast listing workspaces that need updating before restarting.

## [0.8.0-beta.13] — 2026-07-07

### Changed

- Framework tarball now ships `packages/opencode/` and `packages/tui/` (our enhanced opencode fork) plus all supporting workspace packages and root `package.json`/`bunfig.toml` for `bun install --production` resolution.
- `install.sh` runs `bun install --production` from the framework root once, resolving all workspace deps in a single pass.
- `.bin/spinosa` launches `npx @spinosa/tui` when installed, falls back to system `opencode`.
- Handoff runners use the bundled TUI path instead of system `opencode`.
- `package-release.sh` strips test/ and node_modules from opencode/tui packages before packaging.

### Fixed

- Cross-platform build failure for darwin-x64 (onnxruntime arm64-only). Native platform builds handled per-platform.


### Fixed (beta.12 re-release)

- OCR in `addFiles` flow was a no-op stub — now calls `runPpuOcrBatch` to actually process images.
- Multi-folder "new workspace": additional source paths imported via `runAdd` with `subfolder` option, files land in `raw/<foldername>/`.
- Progress counter shown during OCR: status line updates with `5/65 filename → OCR ...` in real-time.
- `ToolStatus` now includes `ocr: boolean` field, `detectDocumentTools` properly checks `ppu-paddle-ocr` availability.
- `finishProvider` error handling: launch failures show in TUI log instead of silent.
- `workspaceAsciiBannerText` strips `-spinosa` suffix including numbered variants (e.g. `-spinosa-28`).
- Type errors fixed: `search.ts` prefix scope, `event.ts` decodeSerializedEvent null guard, `framework.ts` `ver`/`compareFrameworkVersions` issues, `theme/index.ts` `ansiToRgba` return type, missing imports in `onboarding.tsx` and `cli-bridge.ts`.
- `runReinstall`: 120s timeout, ANSI-stripped output, no more `stdio: inherit` leaking CLI into TUI.

## [0.8.0-beta.12] — 2026-07-07

### Fixed

- Upgrade banner now infers release channel from the installed bundle version instead of user config, so a beta install never gets offered a stable upgrade.
- In-TUI upgrade shows step-by-step toast progress and restarts the TUI on completion — no more spawning a separate CLI window.
- Tool repair (`runReinstall`) uses the local `install.sh` with captured output instead of downloading from GitHub, keeping all progress visible inside the TUI.
- `workspaceAsciiBannerText` correctly strips the `-spinosa` suffix from workspace names with dedup numbers (e.g. `corpus-spinosa-2` → `CORPUS-2`).
- All Python vendor dependencies removed from the framework.  `markitdown-ts` and `ppu-paddle-ocr` handle document conversion and OCR as Bun/TS packages.  No more `pip install`, Python runtime, or vendor tarballs.
- Worker no longer crashes on `effect` import (removed stale `Either` barrel import in `event.ts`).  RPC `call()` properly handles `postMessage` failures with `Promise.withResolvers()`.
- `runReinstall` no longer hardcodes `"stable"` channel — inferred from bundle version like all other upgrade paths.
- Three missing imports (`workspaceAsciiBannerText`, `runUpgrade`, `placeholders`) restored in `home.tsx` — fixes TUI crashes on workspace switch.

## [0.8.0-beta.10] — 2026-07-02

### Changed

- `spinosa update` now records a minimal workspace manifest (`file`/`dir`) instead of rebuilding per-file SHA-256 hashes after every update, which removes the slow post-copy hashing phase.
- The update workspace picker now shows only workspaces that are behind the current framework version, dedupes repeated registry entries by path, and skips the redundant confirmation after selecting `All workspaces`.
- Agent mirror refresh now renders a real step progress bar instead of a spinner-only status line.

### Fixed

- `spinosa update` no longer crashes on macOS system Bash 3.2 when the stale-workspace filter sees an empty array under `set -u`.
- Framework template cleanup: removed tracked session residue from `.spinosa/archive/` and reset `.spinosa/memory/orchestrator-notes.md` to a neutral template state.

## [0.8.0-beta.9] — 2026-07-02

### Changed

- `spinosa update` now uses a simpler ownership model: release-managed framework paths overwrite in place, while user-state such as `raw/`, `system/context.md`, and workspace notes is preserved.
- Agent mirror refresh now runs only when `AGENTS.md` or `.agents/` changed, so ordinary framework updates avoid the extra mirror pass.

### Fixed

- Local prerelease builds no longer crash on macOS system Bash 3.2 when rendering the interactive menu.
- Update progress now keeps a single unified spinner/progress state across manifest updates, directory sync, log migration, and mirror refresh, instead of flickering between partial bars and blank states.
- Ctrl-C during timed update operations is handled more quickly, with faster polling and child-process cancellation.
- `.bin/sync-agents.sh` now uses incremental local mirroring, which substantially reduces the time spent on `Refreshing agent mirrors`.

## [0.8.0-beta.8] — 2026-07-02

### Fixed

- `spinosa update` on cloud-folder workspaces now stages manifest and workspace-metadata rewrites locally, copies them back through the timeout-safe path, and time-bounds the final `sync-agents` step so the process no longer appears to freeze immediately after framework copies.
- The `spinosa update` workspace picker now includes a single `All workspaces` action and visually separates utility actions from the registered workspace list.
- Removed stale startup dashboard appendix content from `startup-prompt.md`; startup chart behavior now lives in shared chart-rendering references instead of duplicated prompt-local instructions.
- Added `spinosa-visualizer` to the orchestrator contract in `AGENTS.md` and fixed `.bin/sync-agents.sh` so visualizer mirrors regenerate correctly for Codex, Claude, OpenCode, and Hermes.

## [0.8.0-beta.7] — 2026-07-02

### Fixed

- Channel-less upgrade and auto-upgrade now use `beta: true|false` from `~/.spinosa/metadata/config.yaml` as the single persisted channel switch, so beta installs do not fetch stable releases and stable installs do not fetch beta releases.
- Installer and workspace config bootstrap now persist only `beta: true|false` and remove legacy `release_channel:` entries when rewriting config.

## [0.8.0-beta.6] — 2026-07-02

### Added

- Visualizer coverage for full matrix heatmaps, connected line charts, ridge plots, vertical bars, and categorical histograms, with reusable script helpers.
- Release-channel regression coverage for exact beta installer URLs, rolling channel URLs, installer channel metadata, and channel-aware `--latest`.

### Fixed

- `install.sh --prefix` no longer overwrites the global `~/.local/bin/spinosa` shim, skips PATH/basic-test side effects, and prints the custom install command.
- Global shims now fail with a clear missing-target message if the installed CLI target is broken.
- Beta installs now persist `beta: true`; exact beta installs download immutable `vX.Y.Z-beta.N` assets; installer `--latest` resolves through the active rolling channel.
- Channel version resolution no longer emits `Broken pipe` warnings under `pipefail`.
- Release publishing now validates `PINNED_TAG`, stages exact release installers with immutable tags, and uploads separate rolling-channel installer/checksum assets.
- `test-new-test-vault.sh` preserves and restores an existing global shim during integration tests.

## [0.8.0-beta.5] — 2026-07-02

### Added

- Config consolidation: `last_installed_version` and `auto_upgrade` moved to `~/.spinosa/metadata/config.yaml`. Orphan `scan_permission` removed. Dead `install.yaml` fields stripped. Installer reads/writes `last_installed_version` from config.yaml. (User settings now in one file.)
- Pinned `pypdf==5.1.0` in installer and vendor builds for reproducible Python dependency installs.
- Hash-locked vendor package install: `build-spinosa-vendor.sh` generates a platform-targeted `requirements.txt` with SHA-256 hashes; `install.sh` runs `pip install --require-hashes` when present.
- Pre-install disk space check: installer fails early when free space on temp or install volume is below ~500MB.
- Expanded `spinosa --help` with global flags, command options, conventions, and examples. Per-command `--help` routing for all commands.
- Community documentation files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`. GitHub issue/PR templates.

### Fixed

- Version check cache cleanup now clears channel-suffixed variants (`_stable`, `_beta`).
- `auto_upgrade_check()` now reads `auto_upgrade:` from config.yaml (env var `SPINOSA_NO_UPGRADE_CHECK=1` still takes priority).

## [0.8.0-beta.4] — 2026-07-01

### Fixed

- `spinosa update` on cloud storage: files whose framework content hasn't changed between versions are now detected via local hash comparison and skipped entirely — no cloud I/O, no timeout wait.
- Progress bar now renders before the cloud hash operation, so the spinner animates during the 30s hashing wait instead of staying frozen.

## [0.8.0-beta.3] — 2026-07-01

### Added

- Config-switchable release channel: set `beta: true|false` in `~/.spinosa/metadata/config.yaml`. Auto-upgrade and `spinosa upgrade` respect the persisted preference. Running `spinosa upgrade --channel beta` (or `--channel stable`) saves the choice to config — no manual file editing required.

## [0.8.0-beta.2] — 2026-07-01

### Fixed

- Auto-upgrade no longer offers stable when an installed beta is already newer than the stable channel.
- `spinosa update` progress now keeps the active file line animated during long cloud copy/hash operations.
- Ctrl-C during timed cloud I/O cancels the active child process promptly instead of waiting through retries/timeouts.
- Version comparison now handles prereleases (`0.8.0-beta.1` is newer than `0.7.7`, older than `0.8.0`).

## [0.8.0-beta.1] — 2026-07-01

### Added

- Release channels: rolling stable (`releases/download/stable/install.sh`) and rolling beta (`releases/download/beta/install.sh`)
- `spinosa upgrade --channel beta` — tracks newest beta prerelease (`--channel dev` remains a compatibility alias)
- Stable and beta installs now use explicit rolling GitHub release tags instead of GitHub `latest` / `dev`
- `.bin/lib/spinosa/release_channels.sh` — channel resolution helpers

## [0.7.7] — 2026-07-01

### Fixed

- `spinosa upgrade` re-execs after install so post-upgrade workspace update loads the new framework libraries (avoids stale in-memory update code on cloud workspaces)
- `logs/` → `.logs/` migration skips bulk directory rename on cloud storage (Google Drive FUSE can hang on `mv`)

## [0.7.6] — 2026-07-01

### Fixed

- `spinosa update` on cloud workspaces no longer hangs indefinitely on checksum, directory prune, migration `mv`, or injection append — timeouts on `sha256_file` (cloud), skip `find`/`rm` prune on cloud dirs, stream-first cloud copies
- Hash timeouts no longer mis-classify cloud files as "customized" during update (counted as copy failures instead)
- Legacy `logs/` migration: per-file `safe_copy` fallback after `mv` timeout, Phase 5 finalize pass, auto-archive `session_metrics.tsv` / `user_requests.md` to `.spinosa/archive/`, remove empty `logs/` after retired cleanup
- `docs/reference/testsuite.md` stripped from release bundle and skipped during `docs/` directory copy (retired manifest alone was insufficient)
- Agent-interception skill and `agent_reports/AGENTS.md` updated for `.logs/` / `.spinosa/archive/` paths
- Update logs each manifest path to `~/.spinosa/logs/spinosa.log` so stalled sync shows the current file when the UI spinner freezes

### Changed

- Workspace clutter cleanup: `logs/` → hidden `.logs/` (with `spinosa update` migration from legacy `logs/`)
- `CHANGELOG.md`, workspace `install.sh`, and `docs/reference/testsuite.md` no longer shipped to user workspaces (repo/maintainer only)
- GitHub release `install.sh` asset unchanged (`curl | bash`)
- Artifact naming: `.agents/references/artifact-naming.md`; directory `AGENTS.md`, write-capable agents, templates, and `startup-prompt.md` require human-readable filenames (topic slugs — not `report.md`, `analysis.md`, `batch_001`)

## [0.7.5] — 2026-07-01

### Fixed

- Cloud workspace `spinosa update` / copy no longer hangs indefinitely on Google Drive, Dropbox, or OneDrive — per-file timeout (default 60s, `SPINOSA_CLOUD_COPY_TIMEOUT_SEC`) with explicit failure reason

## [0.7.4] — 2026-07-01

### Fixed

- `spinosa doctor` no longer exits with warning count (e.g. 3) under `set -e` — completes with normal summary and exit 1
- `read_vendor_metadata_field` reads full YAML values (vendor `pip_fingerprint` with spaced ONNX versions)
- Install marks version complete before basic test so `spinosa version` resolves during install smoke check
- Phase A tests: `test-import-routing.sh` frontmatter assertions; `test-install-vendor-reuse.sh` install.sh extract

### Added

- `docs/reference/testsuite.md` — pre-release production gate (automated, install, CLI, workspace, Linux VM, GitHub sign-off)
- `.bin/test-new-test-vault.sh` — maintainer-only `spinosa new` gate against `TEST-VAULT` (repo/testsuite; not shipped to user workspaces)
- Testsuite automation rule: `--launch copy` for non-interactive `spinosa new` (no OpenCode terminal spawn)

### Changed

- Maintainer-only scripts (`.bin/test-*.sh`, `package-release.sh`, `build-spinosa-vendor.sh`, `validate-skills.sh`, `check-doc-contract.sh`) removed from `framework-files.tsv`; listed in `retired-framework-files.tsv` so `spinosa update` drops them from workspaces

## [0.7.3] — 2026-07-01

### Fixed

- `spinosa` no longer crashes on macOS bash 3.2 when run with no arguments (`ORIGINAL_ARGS[@]: unbound variable` under `set -u`)
- Installer only treats a version as "installed" after success (`versions/<ver>/.spinosa-install-complete` + `metadata/install.yaml`)
- Partial/failed installs are removed on retry and no longer trigger false "already installed" upgrade prompts
- `spinosa` CLI resolves only complete version dirs (ignores partial `versions/*` leftovers)

### Added

- `spinosa doctor` warns when incomplete `versions/*` directories are present

## [0.7.2] — 2026-07-01

### Fixed

- Installer no longer exits silently on macOS after vendor checksum (bash 3.2 + `set -u` chained `local` in `vendor_python_for_dir`)
- `prompt_upgrade()` no longer aborts under `set -e` when versions differ (same class as v0.7.1 `spinosa update` fix)
- Basic test failure no longer aborts install before success banner
- `spinosa upgrade` no longer reports hard failure when installer exits non-zero but CLI is present

### Added

- Unified bash logging to `~/.spinosa/logs/spinosa.log` (installer, CLI, upgrade, and `.bin/` scripts)
- ERR trap in installer — failures show line number and log path instead of silent exit

## [0.7.1] — 2026-07-01

### Fixed

- `spinosa update` no longer aborts under `set -e` when CLI is newer than workspace (normal upgrade path)

## [0.7.0] — 2026-07-01

### Added

- `spinosa doctor` — health check for CLI/workspace version skew, document tools, cloud paths, Hermes config drift
- `spinosa update` progress — per-path manifest progress, per-file copy bar for large dirs, changed-path summary
- `spinosa new` converter progress — unified MarkItDown/OCR bar, 1s spinner/elapsed refresh while converting
- CLI reference: upgrade lifecycle, `spinosa update`, integrations section
- Post-upgrade integration checklist (Hermes merge reminder)
- `CHANGELOG.md` and `.bin/test-doctor.sh` shipped via framework manifest

### Changed

- README and FAQ distinguish `spinosa upgrade` (CLI) vs `spinosa update` (workspace)
- Post-upgrade workspace prompt explains vendor mirror regeneration

## [0.6.9] — 2026-07-01

### Added

- Vendor bundle reuse on upgrade when packages unchanged (skips redundant pip reinstall)
- Cloud-safe workspace update: per-file copy with retries and stream fallback for Google Drive / Dropbox / OneDrive

### Changed

- `onboarding.log` records enabled/excluded file-type batches with counts

## [0.6.8] — 2026-07-01

### Added

- Initial cloud-aware workspace update (safe copy tree)

## [0.6.7] — 2026-07-01

### Added

- Onboarding import verification and recovery (`onboarding.log`)
- Install-session PATH activation via `~/.spinosa/env.sh`
