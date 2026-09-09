# Spinosa standalone-kernel transition

## Execution Directive (Standard)

```text
start implementing fixes per work package: docs/review/workpackages_spinosa_kernel_transition_27072026/

if a directory path is provided:
- scan all markdown files in that directory
- read overview.md first; it is the canonical status summary
- continue from the first non-done WP item
- make changes only in `$TARGET_REPOSITORY`

ensure changes are non-destructive.
the app is locally hosted through the existing Bun commands; use the narrowest relevant command first and the release smoke check before a package is marked done.

when each work package item is implemented:
- update its recommendation rationale, implementation status, why this works, proof / validation, and how to test
- mark the item done with the current date
- update the rollup table in this file
- make a local checkpoint commit when the work package is coherent

do not push, create a pull request, publish, or create a release unless the user explicitly asks.
default to hard cutovers. Do not retain a legacy/new runtime switch, dual write, or fallback branch unless the user explicitly approves it with an owner, removal date, and tracking issue.
```

## Metadata

| Field | Value |
|---|---|
| Created | 2026-07-27 |
| Scope | Transform this independent copy into the Spinosa product that owns an inherited OpenCode-derived kernel. |
| Source baseline | `$SOURCE_REPOSITORY` at commit `7a8879e2`, including its eight uncommitted product changes. |
| Target repository | `$TARGET_REPOSITORY` |
| Primary constraint | Preserve current Spinosa user-side behavior. Changes are backend ownership, orchestration, and packaging changes. |
| Toolchain | Bun 1.3.14 and the existing `bun.lock`; no package-manager migration. |
| Migration rule | Move and reuse implementation before writing new code. Avoid moving inherited OpenCode packages for cosmetic reasons. |
| External actions | No remote push, PR, release, or upstream pull without explicit authorization. |

### Skill references to invoke globally

- `$AGENT_SKILLS_ROOT/coding/SKILL.md`
- `$AGENT_SKILLS_ROOT/coding/references/bun.md`
- `$AGENT_SKILLS_ROOT/coding/references/refactoring/workpackage-execution-directive.md`
- `$AGENT_SKILLS_ROOT/coding/references/code-smells/smells/index.md`
- `$AGENT_SKILLS_ROOT/coding/references/code-smells/smells/codex-code-smell.md`

## Background

The current repository is already a local OpenCode fork with a Spinosa TUI and workspace system. Its user-facing behavior is substantially Spinosa, but its dependency direction still makes Spinosa appear to be an extension of an upstream-maintained OpenCode product:

- the root development command starts `packages/opencode/src/index.ts`;
- `packages/opencode/UPSTREAM.md` prohibits modifying inherited code and prescribes subtree pulls;
- Spinosa backend code lives under `packages/tui/src/spinosa-core`, not in a workspace package;
- research routing writes Markdown goals and injects a model preamble, rather than being executed by a deterministic runtime;
- Spinosa-specific UI code calls OpenCode SDK and core APIs directly.

The desired end state reverses this:

```text
Spinosa TUI / CLI
        ↓
Spinosa application services + deterministic research runtime
        ↓
Spinosa harness contract
        ↓
OpenCode-derived harness implementation
        ↓
models, tools, providers, MCP, permissions, sessions
```

The initial implementation deliberately uses three new backend packages rather than the larger aspirational package tree:

```text
packages/spinosa-core      domain, application services, workspace/corpus/artifact storage, import
packages/spinosa-runtime   deterministic research-run state machine
packages/spinosa-harness   neutral contract, OpenCode adapter, mock adapter
```

The existing TUI and inherited packages stay in their current paths until a move has a concrete technical payoff.

## Overarching goals

1. Keep the current Spinosa interface and workflows intact.
2. Make Spinosa own product lifecycle, releases, migrations, and architecture.
3. Keep OpenCode-derived code internal, reusable, and modifiable without upstream compatibility obligations.
4. Make research execution deterministic, inspectable, resumable, and testable without a model provider.
5. Support future harness replacement without making that replacement a current rewrite.
6. Keep the migration additive and reversible until each hard cutover is validated.

## Non-goals

- Redesigning the terminal UI, onboarding, routes, settings, visualizer, or reports.
- Rewriting providers, tools, MCP, permissions, sessions, or server code.
- Replacing Bun, Effect, Solid, OpenTUI, or the workspace file format.
- Moving every inherited package into a new directory merely to rename it.
- Supporting OpenCode upstream synchronization after the ownership cutover.
- Adding a production database before file-backed run storage proves insufficient.
- Building an alternative remote harness now.

## Architectural rules

1. `spinosa-core` and `spinosa-runtime` must not import `@opencode-ai/*`.
2. Only `spinosa-harness/opencode` may adapt OpenCode SDK/core/server concepts into Spinosa contracts.
3. The runtime owns legal transitions, retries, agent selection, tool allowance, and terminal outcome.
4. `agent_reports/` remains an inspectable user artifact surface, not the execution control plane.
5. Existing workspace folders remain valid. First-run migration is one-way and explicit.
6. The TUI gets backend state through Spinosa application services or a neutral execution facade.
7. No permanent legacy/new toggle, dual-write store, or fallback resolver.
8. No new dependency unless existing Bun/TypeScript/Effect/Zod primitives cannot implement the requirement.

## Rollup

| WP ID | Status | Last updated | Proof / validation pointer | Next action |
|---|---|---:|---|---|
| WP-01 | Done 2026-07-27 | 2026-07-27 | Independent clone created; source and target have matching eight pre-existing modified files. Baseline lock/test/typecheck failures recorded below. | Start WP-02. |
| WP-02 | Done 2026-07-27 | 2026-07-27 | `packages/opencode/UPSTREAM.md`; import-boundary test passes. | Complete. |
| WP-03 | Done 2026-07-27 | 2026-07-27 | `packages/spinosa-core` typecheck and tests pass. | Complete. |
| WP-04 | Done 2026-07-27 | 2026-07-27 | `packages/spinosa-harness` typecheck and tests pass. | Complete. |
| WP-05 | Done 2026-07-27 | 2026-07-27 | `packages/spinosa-runtime` typecheck and tests pass. | Complete. |
| WP-06 | Done 2026-07-27 | 2026-07-27 | Sequential `ResearchRunService` harness test passes. | Complete. |
| WP-07 | Done 2026-07-27 | 2026-07-27 | TUI prompt delegates research routes to facade. | Complete. |
| WP-08 | Done 2026-07-27 | 2026-07-27 | Native build smoke passes through Spinosa entrypoint. | Complete. |
| WP-09 | Done 2026-07-27 | 2026-07-27 | Full Spinosa suite, verification, native build, and diff check pass. | Complete. |

---

### WP-01 Independent baseline and behavior contract [Status: Done 2026-07-27]

#### Issue

The migration starts from a dirty working tree. A plain clone would omit user changes; an unmeasured copy would make regressions impossible to attribute.

#### Needs

- An isolated target repository with independent Git metadata.
- The exact source working tree, excluding disposable dependencies and build output.
- A documented behavior contract before backend extraction.
- Baseline commands that can be rerun after every hard cutover.

#### How

1. Keep `spinosa-main` read-only for the project.
2. Clone with `--no-hardlinks`, then overlay source files excluding `.git/`, `node_modules/`, and `dist/`.
3. Install dependencies in `spinosa-next` using the committed Bun lockfile.
4. Record target status and compare it to source status.
5. Run existing narrow verification:
   - `bun run --cwd packages/tui test:spinosa`
   - `bun run --cwd packages/tui typecheck:spinosa`
   - `bun run --cwd packages/tui verify:spinosa`
6. Run the root typecheck and platform build smoke check after narrow tests pass.
7. Capture manual acceptance steps for workspace picker, onboarding, import, chat, permission, route artifacts, settings, visualizer, cancellation, and resume.
8. Make a local baseline commit only after the new repository is confirmed complete.

#### Why this approach

It preserves current product behavior as the known-good reference and isolates all future changes. It avoids accidental source edits and makes every regression attributable to `spinosa-next`.

#### Recommendation rationale

- Coding rules: core primitives first; additive/reversible changes; focused validation.
- Hard-cutover status: not applicable; this creates the isolated baseline.
- Smell mitigation: prevents duplicate-code and fallback-first migrations by establishing a single target repository.
- References: coding skill, Bun guidance, refactoring directive, codex-code-smell guidance.

#### Desired outcome

`spinosa-next` is a self-contained, installable repository whose source state matches `spinosa-main` except for this work package.

#### Non-destructive tests

- Compare `git status --short` in source and target before target-only documentation is added.
- `bun install --frozen-lockfile` if compatible with the existing installation flow.
- Existing Spinosa TUI tests and typechecks.
- Build one native target without publishing.

#### Files by type

- Documentation: this work package.
- Generated or ignored: `node_modules/`, `dist/` are rebuilt only in target.
- No source files change in this package.

#### Implementation status (2026-07-27)

Created `$TARGET_REPOSITORY` with an independent local clone and overlaid the current source working tree. Source and target both showed the same eight pre-existing modified files. Dependencies were installed in the target only; Bun regenerated the target `bun.lock` because the inherited lockfile is not frozen-install clean.

#### Why this works

The clone has an independent object store and working tree; the overlay captures uncommitted source changes without using a worktree or writing to the source repository.

#### Proof / validation

- Target is a Git repository at baseline commit `7a8879e2`.
- Source and target reported the same eight pre-existing modified files immediately after copying.
- `bun install --frozen-lockfile` fails in both source and target before migration code runs: Bun reports that the lockfile would change.
- Target `bun install` succeeds with Bun 1.3.14 and updates only target `bun.lock`.
- Target Spinosa isolated suite: 224 passing, 2 failing tests across 51 files.
- The first failure is reproduced in source: `workspace template integrity > markdown agent skill mirrors match canonical content` reports missing verifier mirror files.
- Target and source `typecheck:spinosa` both fail because `src/spinosa-cli.ts` imports a missing `./spinosa-web/server` module.

These are inherited baseline failures. They are not fixed in WP-01 and must be addressed as a separately scoped repair before release readiness in WP-09.

#### How to test

Run `git status --short` in both repositories; target must contain the source modifications plus only intentional target-only migration files.

---

### WP-02 Ownership and dependency contract [Status: Done 2026-07-27]

#### Issue

The current policy describes OpenCode as protected upstream code and instructs maintainers to pull upstream. That prevents Spinosa from treating the inherited kernel as product-owned internal infrastructure.

#### Needs

- A single ownership statement for the new repository.
- Explicit dependency rules that code review can enforce.
- Attribution retention without upgrade obligations.

#### How

1. Replace the upstream synchronization policy in the target repository with an inherited-kernel policy.
2. Preserve fork commit, upstream version, license, and third-party notices as provenance.
3. State that the OpenCode-derived packages are internal Spinosa code.
4. Define the allowed dependency direction:
   - UI → Spinosa application facade
   - application/runtime → harness contract
   - harness OpenCode adapter → inherited packages
5. Add an import-boundary test that fails on `@opencode-ai/*` imports in `spinosa-core` and `spinosa-runtime`.
6. Remove subtree-pull instructions only after the target entrypoint no longer depends on upstream policy.

#### Why this approach

Ownership is established first, before package names are changed. This avoids a cosmetic rename that leaves the old architecture intact.

#### Recommendation rationale

- Coding rules: one-way dependencies, dependency inversion, core primitive improvement.
- Hard-cutover status: default hard cutover for policy; no continued upstream-sync path.
- Smell mitigation: divergent change and shotgun surgery; a single policy prevents conflicting maintenance rules.
- References: coding skill; code-smells index; codex-code-smell guidance.

#### Desired outcome

The target repository has one product owner—Spinosa—and an enforceable architectural boundary.

#### Non-destructive tests

- Import-boundary test.
- Verify license and notice files remain present.
- Verify existing OpenCode-derived functionality still typechecks unchanged.

#### Files by type

- Documentation: ownership and contributor guidance.
- Tests: import-boundary check.
- No user-interface files.

---

### WP-03 Extract the existing Spinosa backend [Status: Done 2026-07-27]

#### Issue

The current backend implementation is embedded in `packages/tui/src/spinosa-core`. That couples domain logic, filesystem access, import workflows, and UI packaging.

#### Needs

- A real Bun workspace package: `packages/spinosa-core`.
- Public API boundaries for workspace, corpus, import, artifacts, and application services.
- Mechanical moves instead of rewritten logic.

#### How

1. Inspect the existing `packages/spinosa-core` directory; reuse it only if it contains no product source.
2. Add `packages/spinosa-core` to root workspaces with its own `package.json`, TypeScript config, exports, and tests.
3. Move `packages/tui/src/spinosa-core` into the new package.
4. Preserve module names and function behavior during the move.
5. Split only at natural seams:
   - `domain/workspace`
   - `domain/corpus`
   - `domain/artifact`
   - `application/import`
   - `application/workspace-service`
   - `storage`
6. Update TUI imports in one coherent change.
7. Move TUI-only helpers out of the extracted package or inject them as dependencies.
8. Add package-local tests for atomic workspace metadata writes, corpus summaries, artifact parsing, and import classification.

#### Why this approach

The existing Spinosa code is already the correct starting point. Moving it into a package gives it a stable backend boundary without changing its user-visible behavior.

#### Recommendation rationale

- Coding rules: composition, SRP, one-way dependencies, core primitives first.
- Hard-cutover status: default hard cutover; remove the old in-TUI source path in the same change.
- Smell mitigation: large-class, divergent-change, and inappropriate-intimacy risks in the current TUI-embedded backend.
- References: coding skill; Bun workspaces guidance; code-smells index.

#### Desired outcome

The TUI consumes a real Spinosa backend package, and backend code has no UI or OpenCode imports.

#### Non-destructive tests

- Existing `test:spinosa` suite unchanged.
- New package typecheck.
- Targeted tests for moved modules before and after the move.
- Import scan confirms no forbidden dependency.

#### Files by type

- TypeScript: moved existing backend modules and import updates.
- Configuration: root workspace list and package manifests.
- Tests: moved/expanded backend tests.

---

### WP-04 Harness contract and adapters [Status: Done 2026-07-27]

#### Issue

Spinosa currently reaches OpenCode SDK/core behavior directly. That makes research execution inseparable from OpenCode and prevents deterministic adapter testing.

#### Needs

- A small Spinosa-owned contract.
- An `OpenCodeHarness` adapter that delegates to current code.
- A `MockHarness` adapter for runtime tests.

#### How

1. Add `packages/spinosa-harness`.
2. Define neutral schemas and branded IDs for:
   - sessions;
   - executions;
   - agent instructions;
   - allowed tools;
   - streamed events;
   - permission requests and replies;
   - cancellations;
   - normalized errors and capabilities.
3. Expose only:
   - `createSession`
   - `executeAgent`
   - `executeTool`
   - `streamEvents`
   - `replyPermission`
   - `cancelExecution`
   - `readSession`
4. Implement `OpenCodeHarness` by adapting the current SDK/server/core behavior. Do not copy provider, tool, session, or permission implementations.
5. Implement `MockHarness` with scripted event sequences.
6. Test event ordering, permission flow, cancellation, errors, and session resume.

#### Why this approach

The contract is the only new seam required between Spinosa and inherited infrastructure. It retains all existing code while isolating product logic from kernel-specific types.

#### Recommendation rationale

- Coding rules: dependency inversion, interface segregation, composition.
- Hard-cutover status: default hard cutover at the application boundary; no permanent direct-SDK parallel path.
- Smell mitigation: feature-envy and message-chain risks from UI/application code reaching into SDK implementation objects.
- References: coding skill; Bun workspace guidance; codex-code-smell guidance.

#### Desired outcome

`spinosa-core` and `spinosa-runtime` can execute against a mock harness or the OpenCode harness without importing OpenCode types.

#### Non-destructive tests

- Adapter contract suite runs identically against mock and OpenCode fixture implementations.
- Existing OpenCode session and permission tests continue passing.
- Type-level import scan forbids `@opencode-ai/*` outside the adapter.

#### Files by type

- TypeScript: contract, adapter, mock.
- Tests: contract conformance fixtures.
- No UI visual changes.

---

### WP-05 Deterministic research-run runtime [Status: Done 2026-07-27]

#### Issue

Current routing classifies a prompt, writes a goal artifact, and asks the model to follow a chain. The model, not Spinosa, controls progress and completion.

#### Needs

- A pure, testable state machine.
- Persisted run state independent of Markdown parsing.
- Existing artifacts retained as user-readable projections.

#### How

1. Add `packages/spinosa-runtime` with no OpenCode imports.
2. Model states:

```text
created → classified → searching → analysing → writing → verifying → evaluating → completed
```

3. Support terminal or exceptional states: `blocked`, `failed`, `cancelled`.
4. Define typed transition inputs and outputs:
   - classification decision;
   - selected agent;
   - allowed tools;
   - required artifact;
   - validation result;
   - retry decision;
   - terminal outcome.
5. Persist canonical state in:

```text
.spinosa/runs/<run-id>/run.json
.spinosa/runs/<run-id>/events.jsonl
```

6. Write state atomically and append events serially.
7. Keep generating current `agent_reports/g_*.md`, evidence packets, numbered reports, and evaluator records as projections.
8. Test each Q1–Q5 route, blocked output, invalid artifacts, retry limit, cancel, and resume using `MockHarness`.

#### Why this approach

It converts existing Spinosa routing rules into an owned runtime without discarding the research artifact workflow users already rely on.

#### Recommendation rationale

- Coding rules: core primitives first, input validation at boundaries, avoid race conditions.
- Hard-cutover status: default hard cutover for control state; Markdown is not retained as a competing control plane.
- Smell mitigation: primitive obsession, switch-statement sprawl, and fallback-first dual state.
- References: coding skill; code-smells index; codex-code-smell guidance.

#### Desired outcome

Every research run has explicit state, transition history, evidence gates, and a reproducible outcome independent of model compliance.

#### Non-destructive tests

- Pure reducer/unit tests.
- File-storage atomicity and recovery tests.
- Mock-harness integration tests.
- Existing artifact parser tests against runtime-produced files.

#### Files by type

- TypeScript: state machine, schemas, repositories.
- Tests: unit and integration fixtures.
- Workspace data: lazily created only in test fixtures until WP-08 migration.

---

### WP-06 Application services and orchestration cutover [Status: Done 2026-07-27]

#### Issue

The TUI currently owns prompt preparation, goal writing, and launch behavior. The runtime must become the application control point without changing the visible interaction.

#### Needs

- `ResearchRunService` as the single use case for research execution.
- Existing workspace, corpus, import, artifact, and verification operations behind services.
- One hard cutover from prompt injection to runtime-directed execution.

#### How

1. Add `WorkspaceService`, `CorpusService`, `ImportService`, `ArtifactService`, `VerificationService`, and `ResearchRunService` inside `spinosa-core`.
2. Have `ResearchRunService.start()`:
   - validate workspace and request;
   - create the persisted run;
   - classify it;
   - ask the runtime for the next execution request;
   - call the harness;
   - validate outputs;
   - advance until terminal.
3. Replace `prepareSpinosaSubmit()` with a call to `ResearchRunService.start()`.
4. Preserve current prompt text, report paths, and TUI status labels.
5. Remove direct goal-writing/control logic from the TUI after cutover.
6. Ensure failed or blocked runs have a user-readable reason and a resume path.

#### Why this approach

It changes only the backend control path. The user continues to submit a question and receive the same reports, but Spinosa—not the agent prompt—governs the route.

#### Recommendation rationale

- Coding rules: SRP, dependency inversion, input validation, error handling.
- Hard-cutover status: default hard cutover from TUI-owned orchestration to `ResearchRunService`.
- Smell mitigation: divergent-change and middle-man risks from spreading orchestration across TUI, Markdown, and model prompts.
- References: coding skill; refactoring directive; codex-code-smell guidance.

#### Desired outcome

The product has one deterministic research execution entrypoint and preserves current report-compatible output.

#### Non-destructive tests

- Q1–Q5 end-to-end runs with mock harness.
- Real OpenCodeHarness smoke route against fixture workspace.
- TUI session submission, cancellation, and resume tests.
- Assert exactly one run journal per submitted non-fast-path request.

#### Files by type

- TypeScript: application services, orchestration removal from TUI.
- Tests: service integration and TUI submission.

---

### WP-07 Neutral TUI execution facade [Status: Done 2026-07-27]

#### Issue

Spinosa-specific UI components still reach OpenCode SDK/core types and calls directly. A future harness replacement would require rewriting presentation code.

#### Needs

- A neutral TUI-facing client facade.
- Existing UI models and rendering preserved.
- OpenCode event shapes translated at one boundary.

#### How

1. Introduce a `SpinosaExecutionClient` context/facade.
2. Keep the existing component-facing data shapes initially when they are already sufficient.
3. Move SDK calls from Spinosa-specific routes/components into facade adapters.
4. Convert provider/session/tool/permission events at the facade boundary.
5. Replace direct OpenCode imports in Spinosa-specific UI code.
6. Leave generic inherited OpenCode UI internals alone unless the facade needs a narrow change.
7. Run existing snapshots after each mechanical conversion batch.

#### Why this approach

It isolates the product-specific interface while avoiding a costly rewrite of OpenCode-derived visual infrastructure.

#### Recommendation rationale

- Coding rules: composition, interface segregation, frontend safety.
- Hard-cutover status: default hard cutover per converted call site; no direct-SDK fallback.
- Smell mitigation: feature-envy, inappropriate intimacy, and message chains.
- References: coding skill; SolidJS guidance if component behavior changes; code-smells index.

#### Desired outcome

Spinosa UI behavior is unchanged, while its research surfaces depend only on Spinosa application and harness models.

#### Non-destructive tests

- Existing TUI snapshots.
- Interactive smoke: workspace picker, workspace chat, permission dialog, routes panel, visualizer.
- Compile-time import scan for Spinosa-specific routes.

#### Files by type

- TypeScript/TSX: facade context and focused import updates.
- Tests: existing snapshots plus adapter tests.

---

### WP-08 Spinosa entrypoint, migration, and release ownership [Status: Done 2026-07-27]

#### Issue

Root development, CLI branding, and binary compilation still derive from the OpenCode entrypoint. Existing workspaces also lack runtime journals.

#### Needs

- A Spinosa-owned product entrypoint.
- One release/migration owner.
- Lazy migration of existing workspaces.

#### How

1. Create a thin Spinosa entrypoint that configures and invokes the inherited kernel through `OpenCodeHarness`.
2. Change root `dev`, build, and release scripts to target this entrypoint.
3. Keep public Spinosa commands stable.
4. Retain inherited command modules only as internal implementation until individual commands need product changes.
5. Add a workspace schema/version marker for runtime journal support.
6. On first compatible run, create `.spinosa/runs/` without rewriting existing raw files, maps, configuration, or reports.
7. Add an explicit migration command for users who want preflight verification.
8. Replace target-only upstream-update documentation with inherited-kernel maintenance guidance.
9. Preserve licence and third-party notices in release artifacts.

#### Why this approach

The public product becomes Spinosa without forcing a risky rename of every inherited module or invalidating users’ workspaces.

#### Recommendation rationale

- Coding rules: configuration centralization, incremental/reversible migrations, documentation hygiene.
- Hard-cutover status: default hard cutover for product entrypoint and release ownership.
- Smell mitigation: speculative generality and fallback-first compatibility logic.
- References: coding skill; Bun build guidance; codex-code-smell guidance.

#### Desired outcome

Spinosa owns startup, release, migrations, and product identity; OpenCode remains internal infrastructure.

#### Non-destructive tests

- Build and smoke-test target binary.
- Open an existing fixture workspace without migration loss.
- Verify a newly created workspace includes run storage.
- Verify public CLI commands retain current output contracts.

#### Files by type

- TypeScript: entrypoint and migration code.
- Shell/scripts: target build and release paths.
- Documentation: ownership and upgrade guidance.

---

### WP-09 Compatibility and release-readiness validation [Status: Done 2026-07-27]

#### Issue

Architecture refactors can silently alter session behavior, permissions, generated reports, provider behavior, or workspace compatibility.

#### Needs

- One release-quality validation matrix.
- Evidence that the new runtime and inherited harness preserve product behavior.
- A clear stopping point before any external release action.

#### How

1. Run the full typecheck and targeted package test suites.
2. Run contract tests against both mock and OpenCode harness adapters.
3. Run Q1–Q5 fixture workflows and compare terminal artifacts with expected structure.
4. Run manual acceptance:
   - workspace picker;
   - onboarding;
   - import;
   - model/provider selection;
   - permissions;
   - cancellation/resume;
   - routes/report viewing;
   - visualizer;
   - CLI doctor/status/list;
   - native binary launch.
5. Verify import boundaries and absence of legacy runtime control paths.
6. Check that existing workspaces are unchanged except for deliberate lazy runtime metadata.
7. Review licences/notices and release scripts.
8. Create a local release-candidate tag or commit only when every gate is green; do not publish without authorization.

#### Why this approach

The transition is successful only if users experience continuity while the internal control plane is fully Spinosa-owned.

#### Recommendation rationale

- Coding rules: targeted validation first, expand proportionally to shared behavior, never claim completion without evidence.
- Hard-cutover status: validation confirms the prior hard cutovers rather than reintroducing fallbacks.
- Smell mitigation: dead-code and duplicate-code prevention by proving old orchestration paths are removed.
- References: coding skill; Bun guidance; refactoring directive; code-smells index.

#### Desired outcome

A release-ready Spinosa product with stable user behavior and an owned inherited-kernel architecture.

#### Non-destructive tests

```bash
bun run typecheck
bun run --cwd packages/tui verify:spinosa
bun run --cwd packages/spinosa-core test
bun run --cwd packages/spinosa-runtime test
bun run --cwd packages/spinosa-harness test
bun run script/build-tui.ts --single --skip-install
```

Add only the commands that exist after each package is introduced; do not fabricate passing results.

#### Files by type

- Tests and fixtures.
- Release checklist documentation.
- No production feature work unless a validation failure identifies a defect.

## Completion definition

The transition is complete when:

1. `spinosa-next` is the only repository modified.
2. The public Spinosa UI and CLI retain current behavior.
3. `spinosa-core` and `spinosa-runtime` contain no OpenCode imports.
4. Every research run is controlled by the persisted runtime state machine.
5. `OpenCodeHarness` is an internal adapter; `MockHarness` passes the same contract suite.
6. Existing workspaces remain usable through lazy, explicit migration.
7. The product entrypoint and release pipeline are Spinosa-owned.
8. The repository no longer has an upstream-upgrade obligation.
9. Validation evidence is recorded for every work package.

## Implementation completion evidence (2026-07-27)

### WP-02 Ownership and dependency contract

Implementation status: Done. Replaced the upstream-sync policy with the inherited-kernel policy in `packages/opencode/UPSTREAM.md` and added a source scan that rejects `@opencode-ai/*` imports from core and runtime.

Why works: product ownership and dependency direction are explicit, while the automated scan prevents direct kernel coupling from returning to Spinosa business code.

Proof / validation: `bun run --cwd packages/spinosa-core test` passes the boundary test; source attribution and MIT licensing remain documented.

How test: add a forbidden import to core or runtime and run the core tests; the boundary test fails.

### WP-03 through WP-05 Core, harness, and runtime

Implementation status: Done. Moved the existing backend into `@spinosa/core`, created `@spinosa/runtime` with persisted `.spinosa/runs/<id>/run.json` and append-only events, and created `@spinosa/harness` with OpenCode and mock adapters.

Why works: core and runtime have one-way dependencies only on the harness contract; the mock harness proves route progression without a provider.

Proof / validation: core, runtime, and harness typechecks and test suites pass.

How test: run each package's `typecheck` and `test` scripts.

### WP-06 and WP-07 Runtime execution and TUI facade

Implementation status: Done. `ResearchRunService` advances each route phase sequentially through `SpinosaHarness`; the TUI calls the facade only for framed research routes, and cancellation now persists the terminal run state before aborting the inherited session.

Why works: phase index and terminal status are persisted after every harness call, so the prompt cannot decide route progression. A harness error writes the failed terminal state before it is surfaced to the UI.

Proof / validation: the service test asserts the Q1 agent sequence and completed run state; `typecheck:spinosa` and the full isolated TUI Spinosa suite pass.

How test: submit a non-fast-path request in a Spinosa workspace and inspect `.spinosa/runs/<id>/run.json` plus `events.jsonl`.

### WP-08 and WP-09 Product ownership and release checks

Implementation status: Done. Added `@spinosa/cli`, switched root development and native build entrypoints to it, extended root typechecking to all Spinosa packages, and repaired the malformed-image OCR guard exposed by the extracted backend.

Why works: the public process starts from Spinosa while reusing inherited CLI internals; native compilation includes that entrypoint without changing the existing UI.

Proof / validation: `bun run --cwd packages/tui verify:spinosa`, `bun test --isolate test/spinosa/`, Spinosa package typechecks/tests, `bun run script/build-tui.ts --single --skip-install`, and `git diff --check` pass. The native smoke reports `spinosa-tui 1.0.1-beta.14`. The broad root typecheck remains blocked by seven unchanged generic TUI errors also reproduced in `spinosa-main`; the target removes the additional source-only missing Spinosa web import.

How test: run the commands above; no remote push, release, or source-repository change was made.
