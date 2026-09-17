# Linux installer and legacy upgrade audit

Date: 2026-09-09. Baseline: `a9b81a5a2cba825e8ebc9684702e18c51de5cdc5`, version `1.1.0-beta.5`, branch `beta-dev`.

## Conclusion

**There is a reproducible Linux hang in the installer’s input-flush loop.** Bash 5.3.9 repeatedly reports that a pipe is readable, including at EOF, while `read -t 0` consumes nothing. The loop never reaches the actual confirmation read. Bash 3.2.57 on macOS returns immediately in the same probes, explaining why development on macOS can miss this defect. This is a strong explanation for curl reruns freezing at a prompt; without an affected user’s trace, it is not proof that every reported upgrade hang has this cause.

The existing timeout machinery does not cover the whole journey. Startup version probes, version resolution, the outer installer process, and some repair/activation work have separate gaps. The release smoke test also masks installer failures with a binary-copy fallback.

This change contains an audit and safe reproduction probes. **Production fixes are not implemented.** Three GPT Luna Max investigators covered shell mechanics, upgrade entry points, and historical migration; the orchestrator reconciled findings and ran independent probes. A pre-existing edit to `packages/spinosa-kernel/src/generated/template-pack.gen.ts` was preserved.

## Confirmed primary findings

### F01 — P1: Input flushing can spin forever on Linux

- Evidence: `install.sh:172` (`read_from_tty`), `install.sh:184` (`flush_pending_input`), and prompt callers at `install.sh:532`, `install.sh:1150`, `install.sh:1235`.
- `while IFS= read -r -t 0 ...; do :; done` polls availability without consuming input. With piped stdin on tested Linux Bash, the condition remains true even when the writer has closed. The subsequent `/dev/tty` read is never reached. Pending terminal input can trigger the same mechanism.
- Reachability: curl-piped installs and reruns that need install/upgrade/reinstall/downgrade/repair confirmation. A legacy home needing repair reaches a prompt before the install lock and persistent logging are initialized. `--yes` avoids these prompt paths; it does not fix other hangs.
- Reproduction: the companion Python probe, run in the Linux Lima VM, exceeded its two-second watchdog for both a pipe containing `yes\n` and a pipe at EOF. Both returned on macOS Bash 3.2.57.
- The shell investigator also exercised the real `confirm_install` → `read_from_tty` path under a Linux PTY with piped stdin: it remained stuck until an external two-second watchdog killed it.
- Fix: remove flushing unless there is a demonstrated need; otherwise use a consuming, bounded read against the actual terminal descriptor. Never drain the installer’s script input stream. Explicitly handle missing controlling terminals and EOF. A human waiting to answer is expected; a non-consuming busy loop is not.
- Regression: Linux Bash PTY tests for file execution and `cat install.sh | bash`, pending typeahead, EOF, missing TTY, and repair of a legacy home. Verify cancellation and a finite return, not merely prompt text.

### F02 — P1: Unbounded active-binary version probes can stop repair before it starts

- Evidence: `packages/spinosa-core/src/commands/upgrade.ts:86` (`installedUpgradeVersion`) and `:117` (`readEffectiveInstalledVersion`). Both use `spawnSync(binaryPath, ["version", "--json"])` without a timeout.
- Shell equivalents also bypass the timed-step runner: `install.sh:1058` (`get_installed_version`, before download), `:1457` (`verify_active_binary`, after replacement), and `:1678` (PATH resolution/version diagnostics).
- Trigger: active binary/launcher exists but metadata is missing or requires a probe, and that executable blocks during startup. `readEffectiveInstalledVersion` runs early in upgrade, so downloading a healthy replacement is never reached. A synchronous probe also blocks its caller’s event loop.
- Fix: a short, explicit probe deadline with bounded output; treat a failed probe as an unhealthy installation that can be replaced, and report that diagnosis. Metadata should inform version comparisons without becoming evidence that the executable is healthy.
- Regression: a fake old executable that never exits, missing/mismatched metadata, and verification that upgrade reaches a recoverable error or replacement path within the deadline.
- Investigator reproduction: a temporary active executable looping forever caused the core probe to stop after `before-probe` and exceed a two-second external process-group watchdog.

### F03 — P1: Latest-version resolution clears its timeout before reading the body

- Evidence: `packages/spinosa-core/src/system/channels.ts:148` (`resolvePinnedVersionFromInstaller`). Its `finally` clears the abort timer after `fetch()` returns headers; `response.text()` is awaited afterward.
- Trigger: the server/proxy sends headers and leaves the response body open. Resolution can wait indefinitely before installation starts.
- Fix: keep the deadline alive through body consumption and parsing, with cleanup in a surrounding `finally`; handle body-read failures as well as fetch failures.
- Regression: a local response that flushes headers and never ends the body. Assert finite completion and a useful phase-specific error.
- Exclusion: `upgrade.ts` uses `AbortSignal.timeout` for its installer/checksum downloads and release-note fetch. That signal remains active during body reads; these are **not** the same defect.

### F04 — P1: The outer installer subprocess has no deadline and blocks UI work

- Evidence: `packages/spinosa-core/src/commands/upgrade.ts:373`–`:381`: `spawnSync("bash", ...)`, optionally capturing all installer output, with no timeout.
- A shell step timeout protects only that step. A hang elsewhere in the child blocks the entire call. A TUI route invoking this function cannot redraw, process cancellation, or surface captured output while the synchronous call is running.
- Fix: execute asynchronously with streamed phase/output updates and an explicit whole-process deadline. Cancellation must terminate and reap the process tree, allow rollback, then escalate after a grace period. Preserve logs and report the phase that stopped progressing.
- Regression: a silent installer that never exits, cancellation during install, output larger than the capture limit, and proof that UI/event-loop ticks continue.

### F05 — P2: The documented bootstrap download is outside installer safeguards

- Evidence: `README.md:45`; `website/src/lib/install-urls.ts:6` and `:12` publish `curl -fsSL ... | bash` without connection or total download limits.
- Before any script arrives, there can be no installer phase or installer log. Silent curl can wait indefinitely. A producer error can also be masked by the pipeline’s last-command exit status: the companion probe `(exit 22) | bash` exits zero in ordinary Bash without `pipefail`.
- Fix: publish a download-to-temporary-file bootstrap with connection/transfer deadlines, bounded retries, and execution only after successful download. Explain the download phase before starting it. If a pipeline remains, require pipeline failure propagation and remember that a partially downloaded script can already have executed.
- Regression: delayed headers, stalled body, HTTP error, truncation, and an assertion that download failure cannot report successful installation.

### F06 — P1 validation gap: Release smoke can pass after installer failure

- Evidence: `script/smoke-install.ts:161`–`:195`; the release stage consumes this result in `script/release/stages.ts:287`.
- After a failed installer, the smoke script copies the host binary directly into place and tests it. It also succeeds when no host binary is available. That validates a different path from the installer.
- Reproduction: a temporary fixture installer prints `AUDIT_INSTALLER_FAILED` and exits 17; a harmless fake host binary returns zero. The smoke command exits **0** and prints `smoke passed via binary fallback after installer failure`.
- Fix: installation failure must fail the installer smoke gate. Keep direct-binary smoke as a separately named check. Missing host artifacts must be an explicit skip outside a required release gate, or a failure inside it.
- Coverage gap: all 53 existing installer Bats tests pass. Repair prompt tests use `--yes` or `SPINOSA_REPAIR=1`; distribution and Lima smoke use `--yes --no-launch`. These do not exercise the failing interactive Linux path. `script/lima-linux-soak.sh` exercises a virgin home, not an old-to-new upgrade.

## Historical context and repair behavior

The history investigator found no `v1.0.4` tag in the available tag history. The relevant known transition is **source-tree `v1.0.3-beta.9` → compiled-binary `v1.0.3-beta.10`**, introduced by `a6587ab5`. The exact affected release still needs to be obtained from a user; “1.0.4 or similar” should not be silently converted into a specific tag.

The input-flush implementation was restored in `b86271f3` (2026-07-30, “restore installer input flush”); its parent had a no-op helper. It is present in `v1.0.3-beta.0` and the later checked releases; the checked `v1.0.2-beta.15` and `v1.0.1-beta.14` scripts lack this exact loop. A curl rerun executes the newly fetched installer, so an old installed version need not itself contain this bug. Conversely, `spinosa upgrade` initially executes the installed version’s upgrade code: fixing only today’s TypeScript implementation does not repair an old caller that never reaches download.

Current safeguards worth retaining:

- Platform validation rejects unsupported platforms/musl; downloads have curl connection/transfer limits and supervised download steps.
- SHA-256 verification and staged template/doctor checks fail closed before binary activation.
- The current ownership marker, known legacy shims, and completed source runtimes are recognized in parts of the migration flow. Marker-bearing homes lacking an executable are routed to reinstall.
- Known `versions/` runtimes are retained after successful source-to-binary migration. Modified workspace launchers are normally preserved.
- Binary activation uses a same-home staged file and a previous-binary backup, with error/signal restoration. These safeguards exist, but do not make every associated metadata/launcher mutation transactional.

### F10 — P1: Very old real installations can be mistaken for disposable debris

- Evidence: historical `v0.5.17`/`v0.6.9` installers wrote `metadata/install.yaml` without today’s `spinosa: true` marker or completion stamp. Current `is_reclaimable_spinosa_home` (`install.sh:564`) and `spinosa_home_is_owned` (`:608`) do not use that install record as ownership evidence.
- An old home containing only the recognized directory names, with no current executable/workspace markers, can satisfy the debris predicate. `ensure_spinosa_home` then offers repair; `clear_virgin_install_debris` (`:723`) recursively removes `metadata`, `versions`, `templates`, and other allowlisted entries on acceptance, including with `--yes`.
- This is a broader historical repair defect, **not established as the cause of the reported 1.0.x hangs**. A known directory name alone is insufficient evidence that its contents are failed-install debris.
- Fix: recognize validated historical install manifests and classify them as legacy installs. Quarantine ambiguous prior state with a recoverable record instead of treating it as disposable. Preserve metadata and runtimes through migration and only clean up after a verified, explicit retirement step.

### F11 — P2: Other legitimate legacy homes are rejected rather than migrated

- Historical v0.7/v0.8 source layouts have a completed-version stamp but may lack `spinosa: true`. Without a workspace marker, current ownership checks reject them, while the completion stamp correctly prevents debris reclamation.
- Result: `validate_install_paths` (`install.sh:637`) refuses the nonempty home. This is a visible migration failure, not a silent hang.
- `init_global_metadata` (`:908`) also suppresses both move and copy failures when migrating old root-level metadata. Later steps may continue without knowing that prior state was not imported.
- Fix: detect and validate supported historical layouts before ownership rejection; report unsupported/ambiguous layouts with a preservation-first recovery path. Metadata import must either succeed or explicitly stop/defer migration with its error and original files intact.

Historical fixture validation: a temporary v0.6-shaped home containing `metadata/install.yaml` and `versions/0.6.9/` was classified as reclaimable; `ensure_spinosa_home` with `YES=1` removed both directories. A v0.8-shaped home with a completion stamp but no modern ownership marker was rejected. A v1.0.1 marker-bearing fixture validated successfully. These were temporary fixtures, not destructive tests against an actual installation.

### F12 — P1: Binary rollback can leave metadata and launchers describing the failed install

- Evidence: `install.sh:1851`–`:1862` activates the binary, writes the shim/environment/metadata, then migrates registered workspace launchers. `restore_binary_backup_if_needed` (`:1415`) restores the binary but does not restore those other files.
- A later write/migration failure or cancellation can therefore restore the old executable while leaving `last_installed_version` and launchers from the attempted new installation. `get_installed_version` trusts metadata when the executable exists, so a subsequent upgrade can mistake the old executable for the new version and skip necessary repair.
- Confidence: deterministic mutation/rollback mismatch in the current code; a full fault-injected production install was not run. The risk applies to current migrations as well as older layouts.
- Fix: decide and enforce a commit boundary for binary + global metadata + shim, with a rollback record covering all of them. Migrate workspaces as independently reported follow-up work, or include them in an explicit recoverable transaction. Verify the recovered binary and report restoration failures rather than suppressing them.
- Regression: inject failures after each global write and during one workspace migration; rerun the installer and assert that detected version, active executable, and metadata agree.

## Other shell gaps and recovery hardening

### F07 — P2: Untimed workspace and shell configuration work can stop completion

- `install.sh:1296` reads an entire registered workspace launcher with `cat` after only an existence check. A FIFO is accepted and waits for a writer; a slow or unavailable mounted workspace can also block. `migrate_workspace_launchers` runs directly at `:1862` after activation and metadata writes, without a deadline or an initial per-workspace progress message.
- Linux reproduction: passing a temporary FIFO to the real classifier exceeded an external two-second watchdog. Unavailable NFS/FUSE mounts were not reproduced.
- `install.sh:1881` starts `Configure shell PATH` with a displayed **15-second** budget but calls `setup_shell_path` directly. The renderer is not a watchdog, so that budget is not enforced. Shell configuration work runs after the install lock and signal/rollback traps have been released.
- `check_download_disk_space` (`:854`–`:874`, invoked at `:1827`) performs untimed filesystem calls before download progress starts. Stalled remote filesystems are an environment-dependent risk, not a reproduced field cause.
- Fix: inspect only regular launcher files with a bounded read; report each workspace before inspecting it; make unreachable workspace repair independently retryable. Put a real deadline around shell configuration and disk checks, and preserve meaningful failure status. Users should be told when the binary is installed but optional workspace/PATH repair remains incomplete.
- Limitation: a userspace timeout cannot guarantee immediate recovery from uninterruptible kernel I/O. Report the resource and retain recoverable state instead of promising that every filesystem operation can always be killed.

### F08 — P2: Logging misses the most useful evidence

- `main` sets `SPINOSA_LOG_DISABLED=1` at `install.sh:1752`; validation, platform detection, early repair, lock acquisition, and metadata migration occur before logging resumes around `:1811`. An early hang can leave no current install record.
- Staged template ensure/verify and doctor redirect output to `/dev/null` at `install.sh:1396`–`:1412`. The timed-step runner cannot recover discarded diagnostics. Its temporary output is otherwise copied to the permanent log only when the child finishes or times out (`:278`–`:321`), so tailing the permanent log during a stalled step does not show live child output.
- Fix: create an early attempt log in a safe temporary location, display its path immediately, and move/link it into the owned home later. Record stage start, elapsed time, selected paths/version, and cancellation. Stream or tee child diagnostics into that log, keeping concise terminal output. Preserve failure logs across repair retries and report a bounded tail on timeout.

### F09 — P1: Cancellation can hang and timeout can leave live descendants

- `terminate_process_tree` (`install.sh:262`) recursively sends TERM; the timed runner ultimately sends KILL to the top child PID, not an explicitly tracked whole group. Signal handling (`:93`) then waits without its own escalation deadline.
- Linux reproduction: a one-second timed step returned 124 after about two seconds, but its TERM-resistant grandchild remained alive until the harness killed it. A separate probe invoking the signal handler with a TERM-resistant child did not return within two seconds and required external cleanup. This can explain why Ctrl-C appears ineffective or why a retry still encounters surviving helpers.
- The lock is created before its PID is written and before the cleanup trap is installed (`install.sh:1781`–`:1809`). A crash there leaves a PID-less lock, treated as stale only after one hour. A reused live PID or malformed PID is not established as a Spinosa process. These cases normally fail with a message rather than hang, but complicate recovery.
- Fix: supervise a process group with TERM, grace period, KILL, and reap; test that no descendants remain after cancellation. Record lock ownership/identity and clean up only a lock actually owned by this attempt. Diagnose stale ownership without encouraging users to delete an active installer’s lock.

## TUI and CLI recovery routes

### F13 — P2: TUI repair can report completion after failure and lose cancellation ownership

- `packages/tui/src/spinosa/reinstall.ts:55`–`:81` has a 120-second promise deadline, but sends TERM only to the direct Bash child and resolves without ensuring the process tree exited. The returned timeout text is not emitted through the live stderr callback.
- `packages/tui/src/routes/spinosa/add-files.tsx:487`–`:520` and `onboarding-tool-actions.ts:45`–`:76` discard the returned reinstall exit code and continue to a completion/recheck path. A timeout or exit 1 can therefore be described as “Tool repair complete.” Add-files launches the action without a catch/finally covering thrown failures.
- The `tools` step is excluded from cancellation sets in `add-files.tsx:87` and `onboarding.tsx:172`, and these repairs do not register their child through the normal job lifecycle. This is a source-confirmed lifecycle gap; a live interactive UI reproduction was not performed.
- Fix: consume exit status and timeout detail, show failure before allowing retry, restore controls in `finally`, and register one cancellable repair job owning the process group. Its timeout must be consistent with installer budgets: a fixed 120 seconds is shorter than the shell’s permitted 600-second binary download alone.
- Regression: return 1/124, throw, cancel, navigate away, and retry; assert truthful status, controls restored, and no surviving/overlapping installer.

### F14 — P2: Stable upgrade failures suggest the beta installer

- `packages/spinosa-kernel/src/cli/cmd/upgrade.ts:14` hardcodes `installUrlForChannel("beta")`; failure output at `:100`–`:104` uses that recovery URL regardless of the selected channel.
- Fix: derive remediation from the effective/requested channel, including a correctly bounded download command. Verify stable and beta failure hints separately. This is a recovery-direction bug, not a hang.

Core reachability: kernel CLI upgrade calls the version probe at `packages/spinosa-kernel/src/cli/cmd/upgrade.ts:64`; core probes again at `packages/spinosa-core/src/commands/upgrade.ts:245`. TUI Home repair calls the core upgrader with `yes: true, suppressInstallOutput: true` at `packages/tui/src/routes/home.tsx:253` and checks cancellation only after it returns (`:265`). Launch preflight uses the same engine (`packages/spinosa-core/src/commands/preflight.ts:161`) before starting the TUI worker (`packages/spinosa-kernel/src/cli/cmd/tui.ts:255`). Thus current core fixes must be tested beyond the explicit upgrade command.

## Recommended implementation order

1. **Restore the interactive Linux path:** fix F01 and add Linux PTY/curl-pipe regression coverage. Publish the corrected installer to the intended release channel; a new CLI alone cannot help an old caller blocked before download.
2. **Make repair reachable:** bound every executable probe (F02), fix the channel body deadline (F03), and supervise the outer installer asynchronously (F04). Keep the current finite download/stage budgets, adding separate short probe budgets and a finite whole-attempt deadline.
3. **Protect prior installations:** validate historical manifests before reclamation (F10/F11), preserve ambiguous state, and make recovery consistent across binary, shim, configuration, and workspace-launcher changes. Avoid treating “executable file exists” or a matching metadata version as proof of health.
4. **Make failures diagnosable:** early attempt log, live child diagnostics, actual PATH/workspace deadlines, and reliable cancellation/lock ownership (F07–F09).
5. **Make the release gate prove the installer works:** remove the smoke fallback (F06); run the following cases on Linux before shipping another installer change. Retain direct-binary smoke as an additional, separate check.

| Scenario | Expected result / evidence |
|---|---|
| Fresh Linux install via piped script, interactive PTY | Prompt accepts answer; no busy loop; cancellation exits |
| Existing marker-bearing source beta → binary | Preserve config/workspace registry/source runtime; migrate managed launchers |
| Existing binary, same version, healthy | Ordinary upgrade is a clear no-op; explicit reinstall actually runs |
| Existing binary, same version, corrupted or hanging | Health failure permits repair; probe cannot prevent replacement |
| Missing executable or metadata; root-level legacy metadata | Valid legacy state is imported or diagnosed; no silent deletion |
| v0.5/v0.6 manifest-only and v0.7/v0.8 completion-stamped homes | Preserve real installs; do not confuse them with virgin debris |
| Logs-only debris vs. unrecognized files | Only proven debris is reclaimable; foreign/ambiguous state is preserved |
| Download fails before headers, after headers, mid-body | Finite failure with phase and log; no partial script execution or false success |
| Old binary, new binary, or child ignores TERM | Probe/install deadline and cancellation finish; descendants are reaped |
| Crash/permission failure during activation, metadata, or launcher writes | Consistent old/new state or explicit recoverable partial state; truthful failure |
| Concurrent installers / stale or PID-less lock | Safe ownership checks; no deletion of the other live installer’s lock |
| Workspace is missing, FIFO, or on unavailable mount | Identifies offending path; optional repair does not indefinitely block install |
| PATH points to legacy/custom shim; shell config unwritable | Clear command-resolution result and actionable PATH repair status |
| Missing release asset or installer exits nonzero | Required release smoke fails, without binary-copy fallback |

For field triage, obtain the **exact command and last visible line first**, then Bash version, architecture, installation layout/metadata version, and the current attempt log if it exists. If the last line is a confirmation prompt, prioritize F01; if no installer download starts, distinguish outer curl, channel resolution, and the old-binary version probe. Do not ask a user to run an unbounded `spinosa version` to diagnose an executable suspected of hanging. Do not offer blanket `--yes` repair until legacy state is classified: it bypasses F01 but can authorize the debris deletion in F10.

## Validation and limitations

- `bun run test:installer`: 53 passed, exit 0.
- `bun run lint:shell`: passed.
- Companion probes: macOS arm64 / Bash 3.2.57 and Linux aarch64 / Bash 5.3.9. Linux input-loop hangs reproduced with two-second watchdogs. Bootstrap status masking reproduced on both hosts. Installer smoke false success reproduced on macOS; Bun was unavailable in the Linux VM, so that probe was explicitly skipped there.
- Focused upgrade tests reported by the upgrade investigator: core upgrade network/errors 8 passed; TUI reinstall 2 passed; preflight 11 passed; kernel installation 5 passed.
- Investigator Linux probes additionally reproduced the real PTY confirmation hang, FIFO launcher-read hang, surviving timeout descendant, and non-returning cancellation handler. Temporary historical-layout probes confirmed the v0.6 deletion and v0.8 rejection cases described above.
- Audit structure/source-reference checks and Python syntax validation passed; `git diff --check` passed. The Linux VM was returned to its initial stopped state.
- No affected user’s machine, exact invocation, logs, or installed release asset was available. Results establish reachable defects, not a unique diagnosis for every field report. Linux x64, musl, network-mounted homes, and real historical release binaries were not exercised end to end.

Run the bounded, local-only probes:

```sh
rtk proxy python3 docs/review/audits/linux-installer-repros-2026-09-09.py
```

The probes source installer functions with a temporary home, use fake executable fixtures, and make no external network requests. `OBSERVED` describes a defect; it is not a passing regression assertion.
