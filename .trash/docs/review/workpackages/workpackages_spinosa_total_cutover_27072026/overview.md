# Spinosa total ownership cutover

## Execution Directive (Standard)

Implement this work package only in `$TARGET_REPOSITORY`. Continue the first non-done item. Make each migration one-way: legacy names may be read only by the explicit migration routine, never by normal runtime. Do not publish, push, release, or remove user data permanently. Validate every completed item before starting the next one.

## Goal

Spinosa owns every local product surface: command, package namespace, paths, databases, configuration, API headers, service identity, updater, prompts, and documentation. The only non-provenance OpenCode reference allowed after completion is the isolated external **OpenCode Zen** provider adapter.

## Hard invariants

- Normal runtime never reads `.opencode`, `opencode.json[c]`, or `opencode*.db`.
- New files are created only beneath Spinosa names and directories.
- Existing data moves as a whole where possible; SQLite schema and rows are preserved.
- Migration is idempotent, collision-safe, and creates an inspection report.
- No permanent dual-read, fallback, or compatibility switch.
- Zen vendor transport details are contained in one adapter boundary.
- Licence and attribution references remain accurate.

## Rollup

| ID | Status | Deliverable | Proof |
|---|---|---|---|
| TC-01 | In Progress 2026-07-27 | Inventory and machine-enforced allowed-reference list | Search report |
| TC-02 | Todo | Global data/config/cache/state SQLite migration | Fixture migration tests |
| TC-03 | Todo | Project workspace/config/session migration | Fixture migration tests |
| TC-04 | Todo | Spinosa-only config, database, headers, mDNS, API identity | SDK/server tests |
| TC-05 | Todo | Spinosa CLI, prompts, templates, SDK symbols, UI metadata | TUI and typechecks |
| TC-06 | Todo | Disable upstream OpenCode installation/update paths | Unit tests |
| TC-07 | Todo | Zen-only provider adapter and external-reference allowlist | Provider tests/search gate |
| TC-08 | Todo | Full validation and migration acceptance report | Build, Agent-TUI, diff check |

## TC-01 — Inventory and allowlist

- [ ] Enumerate every remaining `opencode` occurrence by file, category, and owner.
- [ ] Define allowed patterns: MIT/provenance notices and `provider/opencode-zen` transport constants only.
- [ ] Mark old GitLab/PoE auth dependencies for vendoring, rebranding, or removal; they are not Zen exceptions.
- [ ] Add a test that fails on an unallowlisted legacy identifier.
- [ ] Record counts before and after each phase.

## TC-02 — Global migration

- [x] Change XDG roots from `opencode` to `spinosa`.
- [x] Change database filenames to `spinosa.db` and `spinosa-<channel>.db`.
- [ ] Replace simple rename with a collision-safe staged migration:
  - [ ] lock migration execution;
  - [ ] copy to a staging sibling directory;
  - [ ] run SQLite `PRAGMA integrity_check`;
  - [ ] atomically promote the staged result;
  - [ ] retain old source recoverably until explicit cleanup;
  - [ ] write a migration manifest with source, target, timestamp, and result.
- [ ] Rename global `opencode.json[c]` only after the global directory move.
- [ ] Migrate log/cache/state/bin/repository directories with no data loss.
- [ ] Add tests for empty target, populated target conflict, already-migrated state, and a database with data.

## TC-03 — Project migration

- [x] Detect and rename `.opencode` to `.spinosa` and `opencode.json[c]` to `spinosa.json[c]`.
- [ ] Make project migration collision-safe and report conflicts instead of silently leaving legacy data.
- [ ] Migrate session storage, plans, plugins, themes, agents, commands, skills, MCP configuration, and workspace markers.
- [ ] Ensure migration runs before all config/session discovery paths.
- [ ] Add fixtures with nested worktrees and parent-directory config discovery.

## TC-04 — Runtime and protocol ownership

- [ ] Replace owned `x-opencode-*` headers with `x-spinosa-*` end to end.
- [ ] Replace owned HTTP API names, service tags, WebSocket names, internal URLs, mDNS names, managed-policy IDs, and telemetry user agents.
- [ ] Rename config schema, remote well-known route, and generated SDK types to Spinosa equivalents.
- [ ] Rename all owned provider/config/session metadata without changing database schema unnecessarily.
- [ ] Update SDK generation source and regenerate output.
- [ ] Add contract tests proving only Spinosa headers are accepted.

## TC-05 — Product language and symbols

- [ ] Rename CLI help, errors, command examples, shell-completion text, server messages, TUI copy, agent prompts, templates, and fixture names.
- [ ] Rename internal modules, type names, context tags, API metadata, and test descriptions.
- [ ] Rename package-local files named `opencode` unless they are the Zen adapter or attribution.
- [ ] Update documentation to use Spinosa configuration and workspace examples.

## TC-06 — Distribution and lifecycle

- [ ] Remove all calls to OpenCode npm, GitHub, Homebrew, Chocolatey, and Scoop update/install APIs.
- [ ] Make update command report that this local Spinosa build is self-managed until Spinosa distribution endpoints exist.
- [ ] Make uninstall remove Spinosa paths/package only.
- [ ] Replace OpenCode GitHub action/workflow setup with Spinosa-owned integration or disable it explicitly.
- [ ] Add tests that updater never calls upstream OpenCode URLs.

## TC-07 — OpenCode Zen boundary

- [ ] Rename the adapter to `provider/opencode-zen.ts`.
- [ ] Keep Zen endpoint/auth/model/provider ID constants only there.
- [ ] Expose label `OpenCode Zen` in the provider UI.
- [ ] Remove or internalize non-Zen OpenCode-branded auth plugins.
- [ ] Add an allowlist test that rejects every other live product reference.

## TC-08 — Validation

- [ ] Run global/project migration fixture tests.
- [ ] Run core, SDK, Spinosa TUI, runtime, harness, and CLI typechecks/tests.
- [ ] Run `bun run dev` in a clean home and assert only Spinosa paths appear.
- [ ] Run native single-target build and `spinosa-tui --version`.
- [ ] Run passing Agent-TUI workflows: global home, onboarding, session, visualizer.
- [ ] Run `git diff --check` and final identifier inventory.
