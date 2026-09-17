# Spinosa quality remediation work packages

Status: In progress — 2026-09-02  
Branch: `codex/quality-remediation-20260901`

This folder records quality-audit fixes. Generated files stay generator-owned. Remaining debt stays visible.

## Work package rollup

| WP | Scope | Status | Evidence / next action |
|---|---|---|---|
| WP-01 | Measurement and CI baseline | Done | Report, baseline, and PR workflow added. |
| WP-02 | Broken-test stability | Done | Core, HTTP recorder, LLM, kernel event/PTY/API suites pass. |
| WP-03 | TUI complexity | In progress | Theme/dialog/onboarding extraction landed; large builders remain. |
| WP-04 | Kernel/provider complexity | In progress | Provider, queue, session, stream helpers extracted; broad metrics remain. |
| WP-05 | Type-safety boundaries | Done (focused) | Custom-tool ingress is schema-validated; repository-wide debt remains. |
| WP-06 | SDK/tool duplication | In progress | SSE, reinstall, and location helpers shared; contract migration deferred. |
| WP-07 | Coverage, test quality, CRAP, mutation | In progress | Scoped mutation passes; repo coverage remains below target and CRAP is unmeasured. |
| WP-08 | Dead code, strictness, architecture drift | In progress | Knip and dependency-cruiser pass; strictness debt remains. |
| WP-09 | Generated data and hygiene | Done (current checks) | Template mirrors, generated pack, and path hygiene checks pass. |
| WP-10 | Final verification and release readiness | In progress | Typecheck, quality, deep suite, mutation, and binary smoke pass; broad thresholds remain open. |

## Validation run

- `bun run typecheck:all` — pass.
- `bun run quality` — pass.
- `bun run quality:full` — pass.
- `bun run quality:report:check` — pass after refreshing baseline for the Stryker lockfile dependency.
- `bun run quality:binary` — pass; host binary version and doctor smoke pass.
- `bun run quality:mutation` — pass; 107/107 mutants killed, 0 survivors.
- `bun run quality:coverage --check` — fails honestly: aggregate 66.66% lines, 72.78% functions, branches unmeasured, and 49 TUI tests fail under the broad coverage runner.

## Current inventory

`bun run quality:report` measures 674,681 logical LOC across tracked files:

| Bucket | Files | LOC | Files ≥500 LOC | `any` | `unknown` |
|---|---:|---:|---:|---:|---:|
| Production | 1,593 | 269,200 | 94 | 267 | 1,336 |
| Tests | 622 | 148,480 | 67 | 407 | 580 |
| Generated | 36 | 30,432 | 5 | 35 | 434 |
| Fixtures | 123 | 121,743 | 1 | 0 | 13 |
| Scripts | 80 | 12,454 | 5 | 7 | 63 |
| Unknown | 207 | 21,667 | 4 | 1 | 6 |

Static graph snapshot reports 74 functions at cyclomatic ≥22 (max 206), 182 at cognitive ≥22 (max 991), and 363 at Halstead difficulty ≥80 (max 1,979.5). CRAP and duplication runners remain unavailable.

## Priority follow-up

1. Fix and isolate the broad TUI coverage failures; add missing coverage until 100% is realistic.
2. Install/configure complexity, Halstead, CRAP, and duplication runners; record real values.
3. Split remaining files ≥500 LOC and remove handwritten `any`/`unknown` at typed boundaries.
4. Finish TUI/kernel decomposition and add integration tests around extracted reducers and renderers.
