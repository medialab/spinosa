# Spinosa Audit Remediation

## Execution Directive (Standard)

Implement the confirmed findings from the audit report non-destructively. Read this overview first, continue from the first unfinished item, run focused Bun tests and the TUI typecheck, and do not add compatibility fallbacks.

## Metadata

- Created: 2026-07-10
- Scope: recovery routing, template integrity, watchers/artifacts, import cancellation, workspace updates, installer lifecycle
- Input: `spinosa-audit-report.md` and current repository code/tests
- Constraints: preserve user edits; archive rather than delete user-modified files; no destructive migration
- Skill references to invoke (global):
  - `skills/coding/SKILL.md`
  - `skills/coding/references/refactoring/workpackage-execution-directive.md`
  - `skills/coding/references/code-smells/smells/index.md`
  - `skills/coding/references/code-smells/smells/codex-code-smell.md`

## Background

The audit mixes confirmed defects, duplicate observations, test requests, and findings already resolved in the current tree. Each package below requires code-path validation before modification.

## Overarching goals

- Fix every reproducible defect in the report.
- Add focused regression coverage and run the maintained Spinosa suite.
- Record stale or non-actionable findings without speculative changes.

## Non-goals

- Unrelated refactors, API redesigns, or release publication.

| WP ID | Status | Last updated | Proof / validation pointer | Next action |
|---|---|---|---|---|
| WP-01 | Done 2026-07-10 | 2026-07-10 | `entry`, `route`, `workspace-launch`, `route-recovery`, app E2E | None |
| WP-02 | Done 2026-07-10 | 2026-07-10 | `template-integrity`; `agentskills validate` | None |
| WP-03 | Done 2026-07-10 | 2026-07-10 | `artifact-watcher`, `orchestrator` | None |
| WP-04 | Done 2026-07-10 | 2026-07-10 | `import-cancellation`, import/fs tests | None |
| WP-05 | Done 2026-07-10 | 2026-07-10 | 13 update-flow tests | None |
| WP-06 | Done 2026-07-10 | 2026-07-10 | installer/CLI tests | None |

### WP-01 Recovery routing and state [Status: Done 2026-07-10]

- Issue: setup states and invalid runtime routes can land on the wrong or blank screen; workspace transitions and reads are race-prone.
- Needs: exhaustive setup routing, safe runtime normalization, workspace-associated async state.
- How: hard-cut over to explicit routes and guarded reads; add regression tests.
- Why this approach: improves the route/state primitives instead of adding caller-specific patches.
- Recommendation rationale: coding rules 1, 8, 9, 11; hard-cutover status: Default hard cutover; smell targets: switch statements and shotgun surgery; references: global skill files above.
- Desired outcome: every setup state resolves deterministically and filesystem failures do not crash navigation.
- Skill references to invoke: global references above.
- Non-destructive tests: entry, route, workspace-launch, recovery, provider tests.
- Implementation status (2026-07-10): added the startup-hub route, exhaustive status routing, safe filesystem reads, runtime route fallback, workspace-associated prompt/transition state, picker restoration, and cwd rediscovery.
- Why this works: routing now derives from the current workspace/status tuple and stale async results cannot navigate another workspace.
- Proof / validation: `bun run test:spinosa` and `bun run verify:spinosa` pass.
- How to test: run entry, route, workspace-launch, route-recovery, service, and app-route E2E tests.

### WP-02 Template and mirror integrity [Status: Done 2026-07-10]

- Issue: stale sync documentation, tracked caches, and incomplete mirror checks.
- Needs/How: correct docs, remove caches, compare canonical mirror contents in tests.
- Why this approach: makes drift fail at test time.
- Recommendation rationale: coding rules 1 and 16; hard-cutover status: Default hard cutover; smell target: comments; references: global skill files above.
- Desired outcome: no generated caches and byte-identical mirrors.
- Skill references to invoke: global references above.
- Non-destructive tests: template-integrity suite.
- Implementation status (2026-07-10): corrected stale docs, removed tracked bytecode, expanded adapter existence/content checks and framework health.
- Why this works: drift and caches now fail the integrity suite.
- Proof / validation: template-integrity passes; `uvx --from skills-ref agentskills validate .agents/skills/spinosa-visualizer` reports valid.
- How to test: run `bun test test/spinosa/template-integrity.test.ts`.

### WP-03 Watchers and artifacts [Status: Done 2026-07-10]

- Issue: polling errors/overlap lose refreshes; goal writes assume directories and are non-atomic.
- Needs/How: serialize callbacks, retry failed snapshots, use atomic writes and ensured directories.
- Why this approach: fixes the shared watcher/write primitives.
- Recommendation rationale: coding rules 8, 9, 11; hard-cutover status: Default hard cutover; smell target: duplicate code; references: global skill files above.
- Desired outcome: durable refresh and artifact delivery.
- Skill references to invoke: global references above.
- Non-destructive tests: watcher and orchestrator tests.
- Implementation status (2026-07-10): asynchronous hashed snapshots, serialized/retried callbacks, atomic goal writes, directory creation, runtime prompt validation, and dead helper removal.
- Why this works: failed callbacks retain the previous snapshot and in-flight callbacks exclude overlap.
- Proof / validation: artifact-watcher and orchestrator tests pass.
- How to test: run those two test files.

### WP-04 Import cancellation [Status: Done 2026-07-10]

- Issue: cancellation is dropped across boundaries and retry can revive old work.
- Needs/How: propagate generation-scoped abort predicates through every import phase and OCR lease.
- Why this approach: one cancellation contract covers callers and phase runners.
- Recommendation rationale: coding rules 1, 8, 11; hard-cutover status: Default hard cutover; smell target: data clumps; references: global skill files above.
- Desired outcome: superseded work cannot write after retry begins.
- Skill references to invoke: global references above.
- Non-destructive tests: pipeline cancellation and workflow guard tests.
- Implementation status (2026-07-10): propagated generation-scoped abort predicates through scan/copy/conversion/OCR/verification/create/add/onboard; serialized destination copies; reference-counted OCR disposal; made generated output writes atomic.
- Why this works: retry cannot reactivate an invalid generation or overlap a write to the same destination.
- Proof / validation: cancellation, workflow, import-integrity, OCR, and fs-safety tests pass.
- How to test: run the focused import tests or `test:spinosa`.

### WP-05 Workspace update safety [Status: Done 2026-07-10]

- Issue: concurrent/partial updates and destructive removals can corrupt a workspace.
- Needs/How: lock updates, journal rollback, atomic metadata writes, archive retired files, correct first-update checksum behavior.
- Why this approach: transaction-like behavior protects the whole update primitive.
- Recommendation rationale: coding rules 5, 8, 9, 11; hard-cutover status: Default hard cutover; smell target: long method; references: global skill files above.
- Desired outcome: failed updates restore prior state and user data is never silently deleted.
- Skill references to invoke: global references above.
- Non-destructive tests: update-workspace suite.
- Implementation status (2026-07-10): added cross-process lock, managed-state snapshot/rollback, atomic metadata, retired-file archival, first-update correction, and policy/dry-run/real-manifest coverage.
- Why this works: failures restore the pre-update managed state and framework removals remain recoverable under `.trash/`.
- Proof / validation: all update-workspace tests pass.
- How to test: run `bun test test/spinosa/update-workspace.test.ts`.

### WP-06 Installer lifecycle [Status: Done 2026-07-10]

- Issue: audit claims dry-run, custom-prefix, uninstall-root, and post-upgrade validation failures.
- Needs/How: reproduce against current installer, modify only confirmed failures.
- Why this approach: avoids regressing code already fixed since the audit.
- Recommendation rationale: coding rules 1 and 5; hard-cutover status: Default hard cutover; explicit No canonical smell; references: global skill files above.
- Desired outcome: lifecycle behavior is covered and correct.
- Skill references to invoke: global references above.
- Non-destructive tests: install-release and CLI tests.
- Implementation status (2026-07-10): fixed dry-run trap lifetime, custom-prefix launcher root/export, uninstall home resolution, and target-version post-validation.
- Why this works: lifecycle commands now resolve the installation home independently from the executing version root.
- Proof / validation: install-release and CLI tests pass.
- How to test: run both focused test files.

## Finding disposition

Every report identifier was checked against the current tree.

| IDs | Disposition | Evidence / rationale |
|---|---|---|
| R1-R7, R9-R13, R17-R24, R26-R29, R31 | Fixed | Exhaustive routes, guarded reads, current-workspace transition keys, serialized refresh, associated prompt/session state, startup hub, onboarding routing, cwd discovery. |
| R8 | No behavior defect | Startup prompt absence and read failure intentionally share the documented safe fallback; the launch decision no longer rejects. |
| R14 | No behavior defect | Unknown external route input is safely rejected by `initialRoute`; runtime normalization now falls back to workspace. |
| R15 | Not a current defect | The cited future route shape does not exist; current legacy shape is explicitly typed and tested. |
| R16 | Intentional invariant | `useRouteData` is an internal typed hook; runtime unknown routes are now normalized before render. |
| R25 | Fixed by lifecycle | Solid resources clean up with their owner; the added cwd poller has explicit `onCleanup`. |
| R30 | Hypothetical only | No KV listeners exist; state order is not observable. |
| A1-A4, A6-A10 | Fixed | Docs corrected, caches removed, health/mirror content tests expanded, bootstrap count corrected. |
| A5 | Already absent | No template `__pycache__` directories remain. |
| W1-W10, W12-W13 | Fixed | Async safe watcher, serialization/retry, atomic writes, directory creation, dead duplicate/helper removal. |
| W11 | Fixed | Unused agent-reports watcher removed. |
| C1-C16 | Fixed | End-to-end cancellation propagation, generation invalidation, destination serialization, atomic output, OCR lease and post-recognize checks. |
| U1-U6 | Fixed | Rollback snapshot, atomic writes, lock, recoverable archive, checksum first-run behavior, dead set removed. |
| U7 | Not a defect | Public update counters are manifest-entry based; dry-run now has direct behavior coverage. |
| U8-U20, U22 | Fixed coverage gaps | Added dry-run, partial failure/rollback, removal, policies, force, concurrency, counters, checksum, downgrade, fresh manifest, metadata, and real-manifest tests. |
| U21 | Covered at primitives | Watcher serialization and atomic update writes are independently regression-tested; they share no mutable transaction state. |
| P1 | Stale finding | `imports` remains a real wizard step and render state in the current code. |
| P2-P6 | Fixed | Generation-safe cancellation plus installer/launcher/uninstall/upgrade corrections and tests. |
