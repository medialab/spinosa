# WP-10 — Final verification

Run date: 2026-09-02

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| Workspace typecheck | Pass | `bun run typecheck:all` |
| Release quality | Pass | `bun run quality` |
| Deep quality suite | Pass | `bun run quality:full` |
| Dependency / unused / generated / syncpack / shell checks | Pass | `bun run lint:deps`, `bun run lint:unused`, `bun run quality:generated`, `bun run lint:syncpack`, `bun run lint:shell` |
| Mutation testing | Pass (scoped) | Stryker: 107 mutants, 107 killed, 0 survivors |
| Quality baseline regression | Pass | `bun run quality:report:check` |
| Coverage check | Fails target | Aggregate 66.66% lines (38,085/57,132), 72.78% functions (4,430/6,087); branch data unmeasured. Coverage runner also reports 49 TUI test failures. |

## Audit thresholds

| Metric | Current evidence | Target | Status |
| --- | --- | --- | --- |
| Cyclomatic complexity | 74 functions ≥22; max 206 (Tokensave snapshot) | <22/function | Open debt |
| Cognitive complexity | 182 functions ≥22; max 991 (Tokensave snapshot) | <22/function | Open debt |
| Halstead difficulty | 363 functions ≥80; max 1,979.5 | <80 | Open debt |
| Lines per file | Production 94 files ≥500 LOC; tests 67 | <500/file | Open debt |
| Test coverage | 66.66% lines; 72.78% functions; branches unmeasured | 100% | Open debt |
| CRAP score | Runner unavailable; unmeasured | <25 | Blocked |
| Surviving mutants | 0 of 107 in configured mutation slice | 0 | Pass (scoped) |
| Dead code | Knip reports no findings | 0 findings | Pass (tool scope) |
| Duplicated code | Runner unavailable; unmeasured | 0 | Blocked |
| Production `any` | 267 lexical tokens | 0 | Open debt |
| Production `unknown` | 1,336 lexical tokens | 0 | Open debt |
| Test `any` / `unknown` | 407 / 580 lexical tokens | 0 / 0 | Open debt |
| Generated `any` / `unknown` | 35 / 434 lexical tokens | 0 / 0 | Generator debt |

## Inventory snapshot

`bun run quality:report` measured 674,681 logical LOC across tracked files. Current guardrails: production 1,593 files, tests 622, generated 36, fixtures 123, scripts 80, unknown 207. The baseline was refreshed after adding the Stryker dependency; no guardrail regression remains.

The remaining complexity, coverage, typing, duplication, CRAP, and generated-data gaps are repository-scale work. They are recorded as open debt rather than represented as solved by tooling exclusions.
