# Changelog

All important changes to Spinosa are in this document.

Format: Keep a Changelog 1.1.0.

Language: Simplified Technical English. Specification: ASD-STE100. Each sentence has one idea. Each sentence has 20 words or less. Each verb uses an approved form. Active voice only.

Release rule: The maintainer must approve a release. No automatic release.

## [Unreleased]

## [1.1.0-beta.17.16] — 2026-09-12

### Changed

- PDFs run in a dedicated import step. Every PDF lands there regardless of engine. Text pages extract direct and image pages transcribe via the selected engine. Vision keeps images only. Code: `packages/spinosa-core/src/import/pipeline.ts`, `packages/spinosa-core/src/import/processors.ts`, `packages/spinosa-core/src/import/import-workflow.ts`, `packages/tui/src/routes/spinosa/onboarding.tsx`, `packages/tui/src/routes/spinosa/add-files.tsx`.

## [1.1.0-beta.17.15] — 2026-09-12

### Changed

- PDFs never route through MarkItDown. Text pages extract via pdf.js and image pages transcribe via vision/OCR in the owning phase. The MarkItDown phase rejects PDFs loudly instead of dropping image pages silently. Code: `packages/spinosa-core/src/import/pipeline.ts`, `packages/spinosa-core/src/extension/classifier.ts`.
- The shared import workflow runs the copy-as-is phase. Kept files show in the file list, count in totals, and land in `_failed_files` on failure. Code: `packages/spinosa-core/src/import/import-workflow.ts`, `packages/spinosa-core/src/import/processors.ts`, `packages/tui/src/routes/spinosa/onboarding.tsx`, `packages/tui/src/routes/spinosa/add-files.tsx`.

### Fixed

- Over-long destinations resolve to the path actually written. Converters return the written path and every caller checks it. Code: `packages/spinosa-core/src/import/tesseract-ocr.ts`, `packages/spinosa-core/src/import/pipeline.ts`, `packages/spinosa-core/src/commands/add.ts`.

## [1.1.0-beta.17.14] — 2026-09-12

### Fixed

- Recover digital PDFs with pdf.js when MarkItDown returns only page markers. A MarkItDown failure no longer implies a scanned PDF. Embedded text is extracted before OCR is queued. Code: `packages/spinosa-core/src/import/pipeline.ts`.

## [1.1.0-beta.17.13] — 2026-09-12

### Changed

- Move deleted workspaces to the OS trash. The folder stays recoverable. Registry entry still removed. macOS uses `~/.Trash`, Linux uses freedesktop Trash with restore info. Code: `packages/spinosa-core/src/utils/trash.ts`, `packages/tui/src/spinosa/service.ts`.

## [1.1.0-beta.17.12] — 2026-09-12

### Added

- Show the live PDF page during vision transcription. The current file line reads `memo.pdf (PG: 3)`. The marker clears when the file finishes. Code: `packages/spinosa-core/src/import/vision-transcribe.ts`, `packages/tui/src/spinosa/import-progress-ui.ts`, `packages/tui/src/routes/spinosa/wizard-ui.tsx`.
- Show a vertical scrollbar in every wizard list. Users see when options, logs, and files scroll. Code: `packages/tui/src/routes/spinosa/wizard-ui.tsx`, `packages/tui/src/routes/spinosa/onboarding-launch-view.tsx`.

### Changed

- Enlarge the wizard panel to 23 rows on tall screens. Option lists scale to 12 rows. Layout stays responsive to terminal height. Code: `packages/tui/src/routes/spinosa/wizard-ui.tsx`.
- Fix the file list height during runs. The area keeps one size while files stream in. The panel no longer jumps. Code: `packages/tui/src/routes/spinosa/wizard-ui.tsx`.
- Remove the background shortcut hint from the wizard. The `Continue in background` button stays. Code: `packages/tui/src/routes/spinosa/onboarding-view.tsx`, `packages/tui/src/routes/spinosa/add-files-view.tsx`.

## [1.1.0-beta.17.11] — 2026-09-12

### Changed

- Hide the background shortcut hint on the vision step. The step keeps its own keys. Other steps still show the hint. Code: `packages/tui/src/routes/spinosa/onboarding-view.tsx`.

## [1.1.0-beta.17.10] — 2026-09-12

### Changed

- Rename the engine to `Tesseract` in checks, options, buttons, and statuses. One name replaces `Tesseract OCR`, `local OCR`, and `Vision Model`. Code: `packages/tui/src/routes/spinosa/onboarding-helpers.ts`, `packages/tui/src/spinosa/onboarding-preview.ts`.
- Rewrite transcription choice details in plain words. Each option states cost, needs, and result. No codes, no binary names, no SDK terms. Code: `packages/tui/src/routes/spinosa/onboarding-helpers.ts`.
- Unify outcome headings on the verb `complete`. `Import complete with failures` and `Import complete with missing files` replace the `finished` variants. Code: `packages/tui/src/spinosa/import-progress-ui.ts`, `packages/tui/src/component/background-import-chip.tsx`, `packages/tui/src/component/dialog-background-import.tsx`.
- Rename error-step `Retry` to `Start over`. The button restarts the scan from folders. It never retries single files. Code: `packages/tui/src/routes/spinosa/add-files-view.tsx`, `packages/tui/src/routes/spinosa/onboarding-result-view.tsx`.
- Rewrite failure lines with an actor. `Spinosa kept the originals` replaces the passive form. The path stays visible. Code: `packages/tui/src/routes/spinosa/onboarding-view.tsx`, `packages/tui/src/routes/spinosa/add-files-view.tsx`, `packages/tui/src/routes/spinosa/onboarding-result-view.tsx`.
- Simplify setup progress lines. `Saving workspace settings` and `Registering the workspace` replace metadata terms. Code: `packages/spinosa-core/src/commands/create.ts`, `packages/tui/src/routes/spinosa/onboarding.tsx`.
- Shorten wizard descriptions to one idea per sentence. Each sentence stays under 20 words. Voice stays active. Code: `packages/tui/src/routes/spinosa/onboarding-view.tsx`, `packages/tui/src/routes/spinosa/add-files-view.tsx`, `packages/tui/src/routes/spinosa/onboarding-launch-view.tsx`.

## [1.1.0-beta.17.9] — 2026-09-12

### Added

- Add bundled OCR tools. Installer provisions tesseract, pdftoppm, and tessdata into `$SPINOSA_HOME/tools/`. Runtime prefers bundled tools over host tools. Doctor shows bundled or host source. Code: `packages/spinosa-core/src/distribution/tools.ts`, `install.sh`.
- Add tessdata top-up. Installer downloads missing eng, ita, and fra data with pinned checksums. Code: `install.sh`.
- Add tool tarball tier. Installer verifies prebuilt per-platform bundles when releases publish them. Falls back to package managers. Code: `install.sh`.

## [1.1.0-beta.17.8] — 2026-09-11

### Added

- Add durable import manifest. System records every terminal file state in `.logs/import-manifest.ndjson`. Resume runs skip done files. Changed files re-process with overwrite. Failed files retry. Removed files prune from tracking. Identity uses path, size, and mtime. Code: `packages/spinosa-core/src/import/manifest.ts`.
- Add resume check to both wizards. Scan step reports already imported, changed, new, removed, and failed counts. Done rows render done at once. Monitor shows resume line in log. Code: `packages/tui/src/routes/spinosa/onboarding.tsx`, `packages/tui/src/routes/spinosa/add-files.tsx`.

## [1.1.0-beta.17.7] — 2026-09-11

### Added

- Add background import. User presses `Continue in background` during vision or OCR phases. Workspace home opens. Import keeps running. Home chip shows progress with red badge on pause. Chip opens monitor dialog. Monitor shows progress, files, errors, logs. Monitor offers retry, skip, change model, cancel. Run finishes with verify and summary in background. Toast shows on pause and finish. Works in onboarding and add-files wizards. Code: `packages/tui/src/spinosa/import-background.ts`, `packages/tui/src/component/dialog-background-import.tsx`, `packages/tui/src/component/background-import-chip.tsx`.
- Add shared vision auth flow. Picker, API key, OAuth, credential note now live in one module. Onboarding wizard and background monitor use same flow. Code: `packages/tui/src/spinosa/vision-auth-flow.tsx`.
- Add vision pause support to add-files. Auth and model errors now pause queue with retry and skip. Before, files failed silently. Tool rows now use shared helper. Code: `packages/tui/src/routes/spinosa/add-files.tsx`.

### Added

- Add local provider wizard. User selects "Local model" in provider list. Wizard asks for name, id, endpoint, format. Wizard asks for models. System probes endpoint `/models` and `/api/tags`. System uses manual list if probe fails. System saves provider to global config `~/.config/spinosa/spinosa.json`. System shows new provider in list. User selects local provider. Calls go to local endpoint. Models come from endpoint. Supported endpoints: Ollama `http://localhost:11434/v1`, vLLM `http://localhost:8000/v1`, oMLX `http://localhost:8080/v1`, LM Studio. Supported formats: OpenAI Compatible `@ai-sdk/openai-compatible`, Anthropic `@ai-sdk/anthropic`, OpenAI `@ai-sdk/openai`, Google `@ai-sdk/google`. Code: `packages/tui/src/component/dialog-local-provider.tsx:1` and `packages/tui/src/component/dialog-provider.tsx:22`.
- Add format choice to export dialog. Dialog shows `md`, `txt`, `json`. User presses `space` or `left`/`right` to change format. Filename extension follows format. Code: `packages/tui/src/ui/dialog-export-options.tsx:5`.
- Add plain text export. Function `formatTranscriptTxt()` creates plain text transcript. Code: `packages/tui/src/util/transcript.ts:112`.
- Add JSON export. Function `formatExportJson()` creates JSON transcript. Code: `packages/tui/src/util/transcript.ts:172`. No server call. Client creates content.
- Add always visible timestamp. Timestamp shows at top right of prompt box. Timestamp uses `theme.textMuted` with `TextAttributes.DIM`. It is very light grey. It is always visible. Code: `packages/tui/src/routes/session/index.tsx:1803`.

## [1.1.0-beta.17.6] — 2026-09-10

### Changed

- Change PDF import routing. System runs pdf.js text census for each PDF. Digital PDFs extract text directly. Scanned PDFs join the image pool. Vision models transcribe them page by page. Tesseract runs only when user selects it. `none` copies PDFs and images as-is. Code: `packages/spinosa-core/src/import/pipeline.ts`, `packages/spinosa-core/src/extension/classifier.ts`.
- Change vision phase to accept PDFs. System renders pages with pdftoppm at 300dpi. System transcribes each page. System combines pages with `## Page N` headers. Format mirrors tesseract output. Code: `packages/spinosa-core/src/import/vision-transcribe.ts`.
- Change verify to respect OCR selection. Verify no longer retries vision files with MarkItDown or tesseract. Verify reports them as still missing without auto-retry. Code: `packages/spinosa-core/src/import/pipeline.ts`.
- Change single-file add to use pdf.js census. Digital PDFs extract directly. MarkItDown no longer touches PDFs. Code: `packages/spinosa-core/src/commands/add.ts`.
- Change MarkItDown PDF fallback to respect selection. Fallback runs tesseract only for tesseract or legacy selection. Vision and copy selections fail honestly. Code: `packages/spinosa-core/src/import/pipeline.ts`.
- Change tools gate to not block on missing Tesseract. Button shows `Continue without local OCR` when only Tesseract is missing. Vision and copy flows never need local OCR. Code: `packages/tui/src/routes/spinosa/onboarding-helpers.ts`.

### Fixed

- Fix dropped files under `none` selection. System previously skipped images. System now copies images and PDFs as-is. Code: `packages/spinosa-core/src/extension/classifier.ts`.
- Fix app exit epilogue. Teardown cleared the epilogue before print. System now keeps the last value after exit starts. Test uses `SPINOSA_FAST_BOOT=1`. Code: `packages/tui/src/app.tsx`.
- Fix stale test expectations. Config test expects `spinosa.default` sound pack. CLI version test sets `SPINOSA_TEMPLATE_ROOT`. Code: `packages/tui/test/config.test.tsx`, `packages/tui/test/spinosa/cli.test.ts`.
- Fix long filename copies. Temp suffix overflowed filesystem limits. Truncate rescue now keeps room for suffix. Permanent failures skip retry rounds. Failed rows turn red at once. Code: `packages/spinosa-core/src/utils/fs.ts`, `packages/spinosa-core/src/import/pipeline.ts`.

## [1.1.0-beta.17.5] — 2026-09-10

### Changed

- Change Vision button to generic copy. Button now shows `Vision Model` not `provider/model`. Phrase `transcript IMGs PDFs with $modelname` now is `with Vision Model`. Code: `packages/tui/src/routes/spinosa/onboarding.tsx:311`, `packages/tui/src/routes/spinosa/onboarding.tsx:2511`, `packages/tui/src/routes/spinosa/onboarding.tsx:1501`, `packages/tui/src/routes/spinosa/add-files.tsx:758`.

### Fixed

- Fix cold start. `isFastPath` now skips `bootstrapBinaryRuntime` `packages/spinosa-core/src/distribution/bootstrap.ts:192` and `Heap.start` `packages/spinosa-kernel/src/cli-main.ts:117` for `--help`, `--version`, `help`, `version`. Saves time for help. Code: `packages/spinosa-kernel/src/cli-main.ts:44`.
- Fix preflight delay. `MIN_STATUS_MS` is now `300` not `1000` `packages/spinosa-core/src/commands/preflight.ts:51`. Cache hit `<150ms` skips delay. No toast when cache is fresh. Cache TTL is `beta 300`, `stable 3600` `packages/spinosa-core/src/commands/upgrade.ts:55`.
- Fix doctor. Doctor is now `effectCmd` `packages/spinosa-kernel/src/cli/cmd/doctor.ts:1`. It shows `Providers: N connected` with `source` and `model count`. It shows `allowlist` and `disabled` lists. It uses `Provider.list()` `packages/spinosa-kernel/src/provider/provider.ts:463` and `Config.get()` `packages/spinosa-kernel/src/config/config.ts:602`.
- Fix Vision API key loop. Picker now runs handshake before confirm. Handshake sends `1x1` PNG to `sdk.client.provider.vision.transcribe` `packages/sdk/src/v2/gen/sdk.gen.ts:3332` with dummy data. Handshake validates endpoint and key and `vision` capability `packages/tui/src/routes/spinosa/onboarding.tsx:407`. Handshake runs for OAuth and API key paths. System shows `Validating {provider}/{model}…` and on `401` shows `auth failed` and keeps picker open. System does not confirm invalid model.

### Changed

- Change export to one method. Before, top bar `Export` and slash `/export` used duplicate code. Now both use `openExportDialog()` `packages/tui/src/routes/session/index.tsx:245`. They call `formatExportContent()` `packages/tui/src/util/transcript.ts:176`. No duplication.
- Change export to support three file types. Popup lets user select `md`, `txt`, or `json`. Default file is `session-<id>.md`. System adds correct extension. System writes to `~/Downloads` or opens editor. No server call. Guide is `packages/tui/src/util/transcript.ts:27`. Tip now says `.md/.txt/.json` `packages/tui/src/feature-plugins/home/tips-view.tsx:175`.
- Increase central column width. `MAIN_CONTENT_MAX_WIDTH` changes from `92` to `100` `packages/tui/src/util/layout.ts:28`. Wizard inner width changes from `72` to `80` `packages/tui/src/routes/spinosa/onboarding-view.tsx:121` and `packages/tui/src/routes/spinosa/add-files-view.tsx:173`. Maturity check now expects `100` `packages/tui/src/spinosa/verify.ts:41`.

### Removed

- Remove `/themes` slash and theme toggle. Remove `theme.switch` `packages/tui/src/app.tsx:1006`, `theme.switch_mode`, `theme.mode.lock`. Remove keybinds `theme_list`, `theme_switch_mode`, `theme_mode_lock` `packages/tui/src/config/keybind.ts:78`. Remove tip `packages/tui/src/feature-plugins/home/tips-view.tsx:174`. Remove scenarios `mega-full-tui.json` `/themes` and `states-theme.json`.
- Remove `/share` and `/unshare` slash. Remove `session.share` `packages/tui/src/routes/session/index.tsx:662` and `session.unshare` `packages/tui/src/routes/session/index.tsx:757`. Remove keybinds `session_share`, `session_unshare` `packages/tui/src/config/keybind.ts:91`. Remove tips. Remove CLI `--share` option `packages/spinosa-kernel/src/cli/cmd/run.ts:161` and `share()` function `packages/spinosa-kernel/src/cli/cmd/run.ts:531`. Remove runtime share `packages/spinosa-kernel/src/cli/cmd/run/runtime.ts:65`.
- Remove `/copy` slash. Remove `session.copy` `packages/tui/src/routes/session/index.tsx:1105` and `messages.copy` `packages/tui/src/routes/session/index.tsx:1062`. Remove keybinds `session_copy`, `messages_copy` `packages/tui/src/config/keybind.ts:86`.
- Remove `/diff` slash name. Keep viewer but remove `slashName:"diff"` `packages/tui/src/feature-plugins/system/diff-viewer.tsx:1064`. Keep `diff.open` palette command.
- Remove `/timestamps` slash and toggle. Remove `session.toggle.timestamps` `packages/tui/src/routes/session/index.tsx:164`, `showTimestamps` memo `packages/tui/src/routes/session/index.tsx:405`, context `packages/tui/src/routes/session/index.tsx:200`, command `packages/tui/src/routes/session/index.tsx:908`, keybind `session_toggle_timestamps` `packages/tui/src/config/keybind.ts:93`. Timestamp is now always visible, not toggled. No `KV` signal `timestamps`.
- Remove stale scenarios `slash-session.json` (`/share`) and `states-theme.json`.

### Fixed

- Fix `tui.test.ts` provider merge test. Change `theme_list` to `session_list` `packages/spinosa-kernel/test/config/tui.test.ts:446`. Test now passes.
- Fix filename extension for export. Function `ensureExportFilename()` now correctly replaces `md`, `txt`, `json` `packages/tui/src/routes/session/index.tsx:229`.
- Fix type errors for `DialogSelect` after STE changes `packages/tui/src/component/dialog-local-provider.tsx:114`.

## [1.1.0-beta.17.4] — 2026-09-10

### Fixed

- Show full provider error data. System now shows `responseBody`, `cause`, `data`. Before it showed only `Failed after 3 attempts`. Log full detail with `Effect.logError`. This helps debug `gemma-4-31b-it:free` limits. File: `provider.ts:242`.

## [1.1.0-beta.17.3] — 2026-09-10

### Fixed

- Show only image-capable models in vision picker. System returns `BadRequest` as `Unauthorized` for `Missing scopes`. ChatGPT OAuth now re-authenticates via red `Vision` menu. Error text is longer (180 chars).

## [1.1.0-beta.17.2] — 2026-09-10

### Fixed

- Show `BadRequest` cause for vision. Server logs `providerID`, `modelID`, `mime`, `stack` to `spinosa.log`. This fixes `gpt-5.4` stale model error.

## [1.1.0-beta.17.1] — 2026-09-10

### Fixed

- Test change only. Same as beta.17. Battery rebuild needs version bump.

## [1.1.0-beta.17] — 2026-09-10

### Fixed

- Keep only one top-right Vision menu. Remove `Change vision model` button. Kernel logs `BadRequest` cause to `spinosa.log`. System validates `capabilities.input.image`. It logs `model not vision-capable` for stale `gpt-5.6`.

## [1.1.0-beta.16] — 2026-09-10

### Fixed

- Keep `Tesseract` selected after click. Guard `hasUserInteracted`. Wait for catalog. Keep Vision menu visible on `markitdown`, `verification`, `error`, `ocr`, `direct`, `setup`. Show Vision menu in red when `visionError` exists.

## [1.1.0-beta.15] — 2026-09-09

### Changed

- Align `openai`, `anthropic`, `google` OAuth with `/model` dialog. `openai` `luna` no longer asks for `OPENAI_API_KEY` when `provider_next.connected`.

### Fixed

- Fix `OcrModelSelector` colors. Only concrete `provider/model` shows `●`. `esc` keeps `Tesseract`. Vision menu is grey panel, blue when active. Queue pause works per file. Fix test fixture `317/319` to `319/319`.

## [1.1.0-beta.14] — 2026-09-09

### Changed

- Use one file `system/configuration.md` for `setup_status`. Remove status from `system/context.md` and `.spinosa/workspace`. Update `meta.ts`, `create.ts`, `startup-prompt.md`, `diagrams.md`.

### Fixed

- Check `system/configuration.md` for resumable workspace. Fix E2E resume test.

## [1.1.0-beta.13] — 2026-09-09

### Changed

- Shorten `startup-prompt.md` to mapping/indexing only. Remove `serendippo`, `verifier`, `evaluator`. Skip Phase 5. Change Phase 6 to `Validate`. Keep `extraction_*.md` in place.

## [1.1.0-beta.12] — 2026-09-09

### Changed

- Remove `spinosa mcp` command. `spinosa --help` no longer lists `mcp`.

### Fixed

- Fix `spinosa upgrade` layout. Use `●` for all phases. Show `Release: tag — date` and link. Use `prompts.confirm` inside box. No raw `readline`.
- Unify `clack` dialogs. Use one `●` and `UI.println(logo)`.

## [1.1.0-beta.11] — 2026-09-09

### Changed

- Make Linux TUI degrade gracefully. Skip palette when `NO_COLOR` or `TERM=linux`. Replace unicode with ascii. Make `manage-stale` responsive at 80 columns.
- Remove `spinosa-visualizer` skill and update chain to `searcher→writer`.

### Fixed

- Fix wordmark dim color. Use `\x1b[2m` and fallback for 256 colors.
- Suppress Linux boot noise. Hide `Cannot load "@napi-rs/canvas"` message.
- Delete stale workspace: Recent list updates immediately after chip delete.

### Removed

- Remove audit repro file. Keep it in `.trash`.

## [1.1.0-beta.10] — 2026-09-09

### Changed

- Left align installer output. Remove left border pad.
- Unify workspace updates. `preflight` now uses `force:true`. One prompt does version and pack update.

### Fixed

- Fix `beta` check TTL. Beta uses `300s`, stable uses `3600s`. System finds `beta.10` after 5 minutes.
- Remove setup brief toast in `home.tsx`.

## [1.1.0-beta.9] — 2026-09-09

### Changed

- Left align output. Remove border.
- Remove `Downloads` scan from installer. TUI `listRegisteredWorkspaces` still finds `workspaces.json`.
- Tidy repo: Move `test/` to `tests/installer`, `script/` to `scripts`.

### Fixed

- Fix shellcheck. Fix `printf` count.
- Use dotted `●` icons for preflight prompts.

## [1.1.0-beta.8] — 2026-09-09

### Changed

- Installer is quiet by default. Use `--verbose` to show details. Always show `Download` and `Installing` waves.
- Use black and white terminal style. Dots are green/cyan/red.

### Fixed

- Show `Install log: ~/.spinosa/logs/spinosa.log` as clickable link on macOS.
- Use `?` cyan for prompts `Repair`, `Upgrade`, `Install`.

## [1.1.0-beta.7] — 2026-09-09

### Changed

- Unify dialog style to `│ ●` and wave `▁▂▃▄▅▆▇█` for all shell and upgrade.

### Fixed

- Fix `spinosa upgrade` warning about `version` word.
- Make shell UI work with macOS Bash 3.2 and Linux Bash 5.3.

## [1.1.0-beta.6] — 2026-09-09

### Fixed

- Fix Linux hang. `flush_pending_input` no longer drains stdin pipe.
- Fix version probes. They timeout in 5 seconds and use metadata.
- Keep abort deadline for channel fetch through body read.
- Publish bootstrap as `curl --connect-timeout 30 --max-time 600 ... && bash` not `| bash`.
- Fail smoke gate when `install.sh` fails.
- Fix workspace launcher classifier. Use bounded `head`.
- Capture early log to `/tmp/spinosa-install-*.log`.
- Use process-group TERM→KILL and lock cleanup.
- Recognize legacy `v0.5/v0.6` and `v0.7/v0.8` stamps as owned.
- Restore shim, `config.yaml`, `env.sh` on rollback.
- Derive channel hint from effective channel.

## [1.1.0-beta.5] — 2026-09-08

### Fixed

- Show clear message for unsupported OS. System supports macOS and Linux glibc on `arm64` and `x64`.

## [1.1.0-beta.4] — 2026-09-08

### Fixed

- Keep converted files when conversion fails.
- Show session deletion error to HTTP boundary.
- Show correct change count for placeholder updates.
- Scrub Cargo metadata path from release binaries.

## [1.1.0-beta.3] — 2026-09-02

### Changed

- Keep prompt editable while turn runs. Steer is available for interruption.
- Split provider, session, stream, TUI, SDK, tool-runtime into typed helpers.
- Add quality, coverage, mutation, generated-data, binary smoke gates.

### Fixed

- Reject bad successful tool output.
- Stop work cleanly on prompt close and abort.

## [1.1.0-beta.2] — 2026-08-30

### Removed

- Remove embedded web UI and `spinosa web` command. Server no longer embeds UI.

### Changed

- Show only core workflow in CLI help. Fourteen commands are visible. Wordmark is large ASCII.
- Large Spinosa wordmark in CLI help.

### Fixed

- Show status lines for at least 1 second before TUI clears screen.
- Fix tool-calling and interrupt.

## [1.1.0-beta.1] — 2026-08-08

### Added

- Add update lockfile. Concurrent installs no longer race.
- Validate workspace folder names. Reject reserved or duplicate names.
- Cap import payloads and batch them. Run OCR one image per worker.
- Add tests for channels, lock, worker payload, classifier, names, yaml-config.

### Fixed

- Fix CORS `Vary: Origin` tracking per request.
- Fix `bypassAgentCheck` to validate agent identity.
- Queue prompts by default. Queued prompts have Steer control.
- Keep session alive when switching workspaces.
- Fix OCR on multi-page PDFs. Retry single page, skip on failure.
- Fix kernel release channel. Validate `beta` install URL and stable fallback.

## [1.0.3-beta.13] — 2026-08-01

### Added

- Show full-screen `Loading conversation engine…` overlay when you open a conversation. Background creates session. Overlay clears when session syncs. Timeout is 30 seconds.
- Add harness loop control. It has turn snapshots, save points, and hooks `prepareNextTurn`, `shouldStopAfterTurn`, `beforeToolCall`. It maps phase to `idle|busy|retry`. It supports `terminate` and `max-steps`.
- Publish `busy/idle` via `session.status`. V1 abort also stops V2. TUI maps `session.next.*` and `permission.v2.*`.

### Changed

- TUI chat uses V1 by default. Set `SPINOSA_SESSION_V2_PROMPT=1` for V2 steer/queue.
- Disable research auto-framing by default. Set `SPINOSA_SKIP_RESEARCH_PREP=0` to enable.
- Queue prompts by default when V2 is on. Queued messages show Steer control. `<leader>return` also steers.

### Fixed

- Filter `session.list` by `workspaceID`. Do not leak global sessions.
- Accept `path` and `filePath` for write/edit/read rows.
- Fix crash `Cannot access promptMounted before initialization`. Declare signal before memo.
- Drop empty assistant rows for OpenAI/DeepSeek.
- Show OCR files in green during phase.
- Force Orchestrator-Editor for startup indexing. Do not use sticky specialist.
- Fix stale template pack check. Use probe files. Offer `Y/n` update before TUI starts.
- Fix new workspace resume bug. Replace store wholesale, not shallow merge.
- Fix cancel of incomplete workspace. Clear active workspace, go to global Home.
- Fix many TUI audit items (queued prompts, compact, session switch, tips, update toast).

## [1.0.3-beta.12] — 2026-08-01

### Added

- Show total count in Recent list when overflow. Show truncated path under name.
- Add per-row stale manager with `×`/`⌕`/`→` glyphs. Scan and Path reuse recovery dialog.
- Add recovery UX for missing index entries. Offer remove, new path, or local scan.
- Add `JobRunner` control plane. It supports start, progress, cancel-by-id. Import and research share cancel path.
- Add processor registry (`direct`/`markitdown`/`ocr`) with shared abort.
- Add MarkItDown NDJSON child with cancel-kill protocol.
- Add shared `runImportWorkflow` for onboarding and add-files.
- Add research and repair to `createImportJob` lifecycle.

### Changed

- Change chip text from `Choose a workspace` to `Pick a workspace`.
- Remove `Show all` overflow control.

### Fixed

- Prefer `wl-copy` on Wayland Linux for handoff clipboards.
- Embed `@napi-rs/canvas` skia file and set `NAPI_RS_NATIVE_LIBRARY_PATH` for OCR.
- Stage ONNX libs under cache or `os.tmpdir()`. Prepend to `LD_LIBRARY_PATH`.
- Reject musl/Alpine early before download.
- Search `/run/media` on Linux for lost workspaces.
- Activate scan on Enter.
- Treat `.pptx` as unsupported for MarkItDown.
- Keep fixed columns in stale dialog. Use one-line action glyphs. Use fixed-height scrollbox.
- Publish research jobs to GlobalBus for cancel.
- Distinguish `@` autocomplete empty vs error.
- Show real error for workspace update and session-create failures.
- Soft-fail `openWorkspace`. Show toast with path and reason. Offer Recover or Choose another.
- Anchor toasts to viewport top-right, not centered column.
- Keep stop overlay visible until job settles or user forces leave.
- Wait for file statuses to settle before showing 100% recap.
- Finish job as `error` when any file fails.
- Run MarkItDown/OCR gates before step chrome advance.
- Keep ProgressBar file list visible at verify/done.
- Show summary with warning/error accents when `failedCount` > 0.

## [1.0.3-beta.11] — 2026-07-31

### Fixed

- Polyfill canvas globals for PDF viewer.
- Show clear missing-file state for markdown viewer.
- Harden TUI resource reads against `ENOENT`.

## [1.0.3-beta.10] — 2026-07-31

### Breaking

- Product is binary-only. Releases publish four executables, `install.sh`, `checksums.txt`, `build-manifest.json`. No source tarball.
- User installs no longer run `bun install`. Active runtime is `~/.spinosa/bin/spinosa`.
- Workspace `.bin/spinosa` is minimal forwarder. System migrates managed launchers.

### Changed

- Installer does checksum download, staged verification, atomic activation, rollback.
- Upgrade, preflight, repair, uninstall no longer use `~/.spinosa/versions` as active runtime.
- Release pipeline builds binaries and smokes installer.
- `--no-bundled-tools` is no-op warning.

### Migration

- Run `install.sh` once. Dormant `versions/` may be removed later.

## [1.0.3-beta.9] — 2026-07-31

### Fixed

- Unify repair path. One prompt for virgin debris, incomplete homes, dependency recovery.
- Never wipe `SPINOSA_HOME`. Only allowlisted debris may be removed.

## [1.0.3-beta.8] — 2026-07-31

### Changed

- Smoke is full by default. Archive mode is structure-only opt-out.

### Fixed

- Show `Installation needs repair` and offer `Repair now?` when `bun install` fails.
- Offer non-frozen `bun install` for upgraders.

## [1.0.3-beta.7] — 2026-07-31

### Fixed

- Refresh and commit `bun.lock` after version sync.

## [1.0.3-beta.6] — 2026-07-31

### Added

- Add `bun run quality` gate. Add `bun run release:republish` path.
- Seed `.spinosa/framework-checksums.json` for refresh.
- Add smoke stage and patch doc generator.

### Changed

- Copy only `workspace-files.tsv` declared paths.
- Remove 1-second delay from launch preflight.
- Simplify version cache to two-line file with 1-hour TTL.
- Use `tsc --noEmit` for typecheck.
- Move `markitdown-ts`, `pdfjs-dist`, `ppu-paddle-ocr` to `@spinosa/core` only.
- Declare `@spinosa/core` in `spinosa-cli`.
- Update privacy and development docs to local-first.

### Removed

- Remove GitHub quality workflow. Validation is local `bun run release:validate`.

## [1.0.3-beta.5] — 2026-07-31

### Fixed

- Link `@opentui/*` into framework root after `bun install`. Use `bun --preload @opentui/solid/preload`.

## [1.0.3-beta.4] — 2026-07-30

### Fixed

- Open caller project when launcher uses `bun --cwd`. Prefer `PWD` for framework cwd.
- Keep session status and provider catalog live without wipe on connect.

## [1.0.3-beta.3] — 2026-07-30

### Fixed

- Load OpenTUI Solid via `bun --cwd <root> --preload` so TUI renders from any directory.
- Reject broken `bun --preload … run …` argv.

## [1.0.3-beta.2] — 2026-07-30

### Changed

- Write real `auto_upgrade` to `~/.spinosa/metadata/config.yaml`.
- Rebrand leftovers to Spinosa. Keep OpenCode Zen/Go providers.
- Change worktree prefix to `spinosa/`.

### Removed

- Remove `spinosa github` and `spinosa acp` commands.
- Remove fake tips for github install.

### Fixed

- Fix picker Escape. Restore previous route on failed open.
- Use `spinosa export` without `--session`.
- Add note for stable channel.

## [1.0.3-beta.1] — 2026-07-30

### Changed

- Replace `release-it` with `script/release/` orchestrator. Stages: preflight, bump, build, verify, tag, publish, channel, verify.
- Sync versions via `script/set-version.ts` to root, `install.sh`, and product packages.
- Require `CHANGELOG.md` heading for release.
- Move orphan scripts to `script/orphan/`.

### Fixed

- Fix stale product package versions.

## [1.0.2-beta.15] — 2026-07-30

### Changed

- Unify launch preflight in kernel TUI. `spinosa` and `bun run dev` use same path.
- Consolidate upgrade engine, preflight, version sync in `@spinosa/core`.
- Rewrite release docs for custom orchestrator.

### Fixed

- Run same upgrade check for `bun run dev`.

## [1.0.2-beta.2] — 2026-07-28

### Fixed

- Launch TUI from `packages/tui/src/spinosa-cli.ts`. Fix `Spinosa not found` on fresh installs.

## [1.0.2-beta.1] — 2026-07-28

### Security

- Write logs and registry with `0600` and directories with `0700`. Redact keys (`authorization`, `password`, `token`, `api_key`). Scrub `Basic`/`Bearer` credentials.
- Reject `auth_token` query param. Use `Authorization` header.
- Refuse non-loopback bind without `SPINOSA_SERVER_PASSWORD`.

### Changed

- Update deps: `esbuild` `0.28.1`, `solid-js` `1.9.14`, `vite` `7.3.5`.

## [1.0.1-beta.14] — 2026-07-24

- No user changes. Build pipeline fix.

## [1.0.1-beta.13] — 2026-07-23

- No user changes. Tag cleanup.

## [1.0.1-beta.12] — 2026-07-23

### Changed

- Remove TrOCR and LLM OCR post-processing. Keep `ppu-paddle-ocr` only.

## [1.0.1-beta.11] — 2026-07-23

### Fixed

- Move all upgrade awareness to `spinosa upgrade` CLI. TUI never prompts upgrade.

## [1.0.1-beta.10] — 2026-07-23

### Fixed

- Re-fetch remote version on every TUI mount. Show upgrade prompt reliably.

## [1.0.1-beta.9] — 2026-07-23

### Fixed

- Offer workspace update after `spinosa upgrade` in same CLI flow.

## [1.0.0] — 2026-07-20

### Added

- First stable release. All beta changes are now stable.
- Check for updates on start. Prompt to upgrade.
- Add `Delete stale` button to workspace picker.
- Prompt before `spinosa upgrade` install.

### Changed

- Move repo from `TommasoPrinetti/spinosa` to `medialab/spinosa`.

### Fixed

- Clean 108 stale e2e entries. Do not auto-open last workspace from outside.

## [0.9.0-beta.27] — 2026-07-20

### Fixed

- Prompt `[Y/n]` before `spinosa upgrade`. Use `--yes` to skip.

## [0.9.0-beta.26] — 2026-07-20

### Added

- Prompt with `Yes` to install update immediately, then exit TUI.

## [0.9.0-beta.25] — 2026-07-20

### Added

- Check for updates on start. Show `Checking for updates…` in boot screen.

## [0.9.0-beta.24] — 2026-07-18

### Added

- Add `@spinosa/tui-agent` for agent TUI debugging. Package has CLI `tui-agent run`, scenario DSL, agent control loop, artifacts. See `packages/tui/tools/tui-agent/README.md`.
- Add `/session` alias for `/sessions`.

### Changed

- Scope `/session` to active workspace path, not host dir.
- Add `workspaceID` filter to `session.list` HTTP API.

### Fixed

- Change `onMouseDown` to `onMouseUp` for footer. Fix dialog backdrop.
- Make dialog height responsive to terminal height.
- Use column layout for dialogs. Content shrinks inside small modals.
- Keep session list scrollable inside small modals.
- Use columnar layout for export options on narrow terminals.
- Make workspace picker columns responsive. Hide `Version` below `72` cols, `Accessed` below `94`.
- Add `›` indicator to picker. Use `compactColumns()` for narrow width.
- Hide chrome below `24` rows. Limit recent cards to 1.
- Fall back to bold plain text when terminal too narrow for block font.
- Hide stacked inspector and shortcut bar below `28` rows.
- Hide overflow in prompt workspace status bar. Show pipe below `80` cols.

## [0.9.0-beta.22] — 2026-07-17

### Fixed

- Land on global homepage, not last workspace.
- Fix 14 TypeScript errors.
- Prefer installed release over dev repo `spinosa-main` for workspace creation.
- Remove stale serena MCP config.

## [0.9.0-beta.21] — 2026-07-17

### Fixed

- Fix macOS `Killed: 9` after install from `com.apple.provenance` xattr. Warm up `bun` after install. Retry verify 3 times.
- Write `spinosa: true` marker to `metadata/config.yaml`. Fix uninstall error.
- Clean duplicate `PATH` entries in `.zshrc`.

## [0.9.0-beta.20] — 2026-07-17

### Fixed

- Do not auto-launch dashboard from `curl | bash`. Installer only installs. User launches with `spinosa`. Use `spinosa version` for probe.

## [0.9.0-beta.19] — 2026-07-17

### Fixed

- Do not hang installer after success. Launch dashboard detached with `nohup`.

### Changed

- Group installer output into sections. Each line has glyph `→`/`✦`/`⚠`/`↳`/`✗`/`?`.

## [0.9.0-beta.18] — 2026-07-17

### Fixed

- Ship `run-with-timeout.ts` under `workspace-template/.bin/` so installs can run `bun i`.

## [0.9.0-beta.17] — 2026-07-17

### Fixed

- Show spinners for every long step. Never show silent terminal.
- Detect existing Spinosa marker correctly. Do not append duplicate PATH.
- Compute symlink depth correctly. Accept nested symlinks, reject escaping symlinks.
- Guard `~/.spinosa` home. Never resolve `rm -rf` to `/bin`.
- Report dashboard launch failure with hint to run `spinosa` manually.

### Changed

- Use exit-status capture for version compare.

## [0.9.0-beta.16] — 2026-07-17

### Added

- Add persistent workspace IDs and registry metadata for presence, setup state, recovery.
- Do visible cleanup and identity checks before TUI open.
- Allow relocate, scan, or remove for missing workspaces.
- Support resume of interrupted imports.

### Changed

- Exclude missing entries from Recent. Label incomplete imports. Route incomplete workspaces to onboarding.
- Confirm cancel and stop process before back navigation.
- Repair dependencies while keeping central metadata.

### Fixed

- Remove native build for `node-gyp` WASM shell parser. Stream output and timeout.
- Remove stale bold styling on Linux.
- Keep CLI interactive for uninstall.
- Show global-home actions after incomplete import.
- Refresh picker before return after remove.

## [0.9.0-beta.13] — 2026-07-14

### Added

- Require provider selection before workspace create.
- Add session and workspace selection, multiple visualizer modes, tool details, copyable commands to visualizer.

### Changed

- Align visualizer controls with TUI layout conventions.

### Fixed

- Make release tests track home navigation without mock leaks.

## [0.9.0-beta.9] — 2026-07-12

### Changed

- Run upgrade checks in CLI before TUI start. Update all registered workspaces, then request fresh `spinosa` launch.
- Remove upgrade networking from TUI home.

### Fixed

- Accept `spinosa --json status`. Honor workspace paths. Reject invalid workspaces.

## [0.9.0-beta.8] — 2026-07-12

### Fixed

- Verify new release after upgrade, not old release.
- Import correct `Dirent` type for Spinosa typechecks.

## [0.8.0-beta.16] — 2026-07-08

### Fixed

- Enforce `replace_if_unmodified` via SHA-256 checks.
- Fix `spinosa uninstall` confirm delay on macOS bash 3.2.

### Changed

- Skip re-check for 1 hour when no upgrade is available.
- Show toast with workspaces that need update before restart.

## [0.8.0-beta.13] — 2026-07-07

### Changed

- Ship `packages/opencode/` and `packages/tui/` plus supporting packages for `bun install --production`.
- Run `bun install --production` from framework root once.
- Launch `npx @spinosa/tui` when installed.
- Use bundled TUI path for handoff runners.
- Strip `test/` and `node_modules` from packages before packaging.

### Fixed

- Fix darwin-x64 build for onnxruntime. Handle native per-platform.

## [0.8.0-beta.12] — 2026-07-07 (second release)

### Fixed

- Fix OCR stub in `addFiles`. Now calls `runPpuOcrBatch`.
- Import additional sources via `runAdd` with `subfolder`.
- Show OCR progress `5/65 filename → OCR`.
- Add `ocr` boolean to `ToolStatus`. Check `ppu-paddle-ocr`.
- Handle `finishProvider` launch failures in TUI log.
- Strip `-spinosa` suffix for banner text.
- Fix type errors in `search.ts`, `event.ts`, `framework.ts`, `theme/index.ts`, `onboarding.tsx`, `cli-bridge.ts`.
- Fix `runReinstall` timeout and ANSI leak.

## [0.8.0-beta.12] — 2026-07-07

### Fixed

- Infer channel from bundle version, not user config. Beta never gets stable upgrade.
- Show toast progress for in-TUI upgrade and restart.
- Use local `install.sh` for tool repair. Show progress in TUI.
- Fix banner strip for `corpus-spinosa-2`.
- Remove Python deps from framework. Use `markitdown-ts` and `ppu-paddle-ocr`.
- Fix `effect` import crash. Handle `postMessage` failures.
- Infer channel from bundle version for `runReinstall`.
- Restore missing imports in `home.tsx`.

## [0.8.0-beta.10] — 2026-07-02

### Changed

- Record minimal workspace manifest (`file`/`dir`) after update. Remove slow hashing.
- Show only workspaces behind current version in picker. Deduplicate by path.
- Show real progress bar for agent mirror refresh.

### Fixed

- Fix `spinosa update` crash on macOS Bash 3.2 with empty array.

## [0.8.0-beta.9] — 2026-07-02

### Changed

- Overwrite framework paths in place. Preserve `raw/`, `system/context.md`, workspace notes.
- Refresh agent mirrors only when `AGENTS.md` or `.agents/` changed.

### Fixed

- Fix menu crash on Bash 3.2.
- Keep spinner and progress state unified.
- Handle `Ctrl-C` with faster polling and cancellation.
- Use incremental mirroring for `sync-agents`.

## [0.8.0-beta.8] — 2026-07-02

### Fixed

- Stage manifest rewrites locally. Copy back via timeout-safe path. Bound `sync-agents` time.
- Add `All workspaces` action to picker.
- Remove stale appendix from `startup-prompt.md`.

## [0.8.0-beta.7] — 2026-07-02

### Fixed

- Use `beta: true|false` from `~/.spinosa/metadata/config.yaml` as channel switch. Fix `beta` vs `stable` fetch.

## [0.8.0-beta.6] — 2026-07-02

### Added

- Add visualizer coverage. Add release-channel regression coverage.

### Fixed

- Do not overwrite global `~/.local/bin/spinosa` shim with `--prefix`.
- Fail with clear message if CLI target is broken.
- Persist `beta: true` for beta installs. Download immutable `vX.Y.Z-beta.N` assets.
- Remove `Broken pipe` warnings.
- Validate `PINNED_TAG` and immutable tags.

## [0.8.0-beta.5] — 2026-07-02

### Added

- Move `last_installed_version` and `auto_upgrade` to `~/.spinosa/metadata/config.yaml`.
- Pin `pypdf` and hash-lock vendor install. Add disk space check.
- Add `spinosa --help` with global flags and examples. Add community docs.

### Fixed

- Clear channel-suffixed cache variants.

## [0.8.0-beta.4] — 2026-07-01

### Fixed

- Skip unchanged framework files via local hash. No cloud I/O.
- Show progress bar before cloud hash. Spinner animates.

## [0.8.0-beta.3] — 2026-07-01

### Added

- Add channel switch `beta: true|false`. Save choice via `spinosa upgrade --channel`.

## [0.8.0-beta.2] — 2026-07-01

### Fixed

- Do not offer stable when beta is newer.
- Animate file line during long cloud copy.
- Cancel child process promptly on `Ctrl-C`.
- Handle prerelease compare `0.8.0-beta.1` vs `0.7.7`.

## [0.8.0-beta.1] — 2026-07-01

### Added

- Add rolling stable and beta channels. Add `spinosa upgrade --channel beta`.
- Add channel helpers `release_channels.sh`.

## [0.7.7] — 2026-07-01

### Fixed

- Re-exec after install so post-upgrade update uses new libraries.

## [0.7.6] — 2026-07-01

### Fixed

- Add timeouts for cloud checksum, prune, `mv`, injection. Use stream-first cloud copies.

## [0.7.5] — 2026-07-01

### Fixed

- Add per-file timeout for cloud copy. Default 60 seconds.

## [0.7.4] — 2026-07-01

### Fixed

- Fix `spinosa doctor` warning count exit. Complete with summary.

## [0.7.3] — 2026-07-01

### Fixed

- Fix `spinosa` crash on macOS bash 3.2 with `ORIGINAL_ARGS`.
- Remove partial installs on retry.
- Resolve only complete `versions/*` dirs.

### Added

- Warn about incomplete `versions/*` dirs.

## [0.7.2] — 2026-07-01

### Fixed

- Fix installer vendor checksum flow.
- Fix `prompt_upgrade` abort with `set -e`.
- Show banner for basic test failure.
- Handle `spinosa upgrade` installer non-zero with CLI present.

### Added

- Log to `~/.spinosa/logs/spinosa.log` unified. Show line number on failure.

## [0.7.1] — 2026-07-01

### Fixed

- Fix `spinosa update` abort with `set -e` when CLI newer than workspace.

## [0.7.0] — 2026-07-01

### Added

- Add `spinosa doctor` with version skew, tools, cloud path, Hermes checks.
- Add `spinosa update` progress with manifest and file bar.
- Add converter progress for `spinosa new`.
- Add CLI reference for upgrade and `spinosa update`.

## [0.6.9] — 2026-07-01

### Added

- Reuse vendor bundle when packages unchanged.
- Make workspace update cloud-safe with per-file copy.

### Changed

- Record `onboarding.log` with enabled batches and counts.

## [0.6.8] — 2026-07-01

### Added

- Add cloud-aware workspace update.

## [0.6.7] — 2026-07-01

### Added

- Add import verification and recovery.
- Activate PATH via `~/.spinosa/env.sh`.
