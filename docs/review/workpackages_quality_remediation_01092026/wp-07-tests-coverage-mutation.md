# WP-07 — Coverage, test quality, CRAP, mutation

Status: In progress — 2026-09-02

## Goal

Make tests meaningful, measure runtime coverage, and enforce mutation quality without hiding unmeasured code.

## Delivered

- Added `script/quality-coverage.ts` and root `quality:coverage` / `quality:coverage:check` commands. The runner inventories every workspace, reports source files with no record, and treats missing branch counters as unmeasured.
- Added pinned `@stryker-mutator/core@9.2.0`, `stryker.config.mjs`, and `script/quality-mutation.ts`. The scoped command covers provider transforms, tool runtime, and TUI selection with Bun tests and propagates failures.
- Added focused parser, command, tool-runtime, and TUI model tests. CI runs coverage and mutation gates and uploads their reports.
- Current Stryker run passes: 107 mutants, 107 killed, 0 survivors.

## Open blockers

- Full repository coverage is not 100%. Current aggregate is 66.66% lines and 72.78% functions; Bun lcov output has no branch counters.
- Broad coverage execution reports 49 TUI test failures because those suites need their existing isolated/runtime setup. `quality:full` remains green because it runs the release-critical isolated suites.
- CRAP and duplicate-code runners are not installed/configured, so those metrics remain unmeasured.

## Acceptance

Coverage must represent runtime execution, not call-graph reachability. Mutation acceptance is zero survivors in the configured scope; the current scoped run meets that bar. Full-repository thresholds remain future work and are recorded as debt.
