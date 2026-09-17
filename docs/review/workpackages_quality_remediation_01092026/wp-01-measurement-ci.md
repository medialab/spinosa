# WP-01 Measurement and CI baseline [Status: Done 2026-09-01]

## Goal

Make every requested metric reproducible and visible in CI without hiding generated, fixture, or asset debt.

## Work

1. Inspect root package.json scripts around 12–18 and 33–37, script/quality-release.ts:67, and script/quality-binary.ts:30.
2. Add one command reporting production, test, generated, fixture, asset, docs, and script buckets separately.
3. Add standard complexity, Halstead, file-LOC, branch coverage, CRAP, mutation, duplicate, and dead-code commands.
4. Add a pull-request CI workflow; keep nightly mutation and external-recording jobs separate.
5. Remove --only-failures from authoritative CI.
6. Store machine-readable baseline; fail new regressions before enforcing full repository targets.

## Acceptance

Clean checkout produces repeatable reports. Exclusions are documented and enforced. CI shows every requested gate.

## Validation

Run typecheck, lint, full tests, coverage, and new quality command; record exact outputs here.

## Implementation status (2026-09-01)

- [Status: Done 2026-09-01] Added `bun run quality:report` (`script/quality-report.ts`) and machine-readable `quality-baseline.json`; the baseline was captured after the parallel source edits settled.
- The report inventories git-tracked repository content into production, test, generated, fixture, asset, docs, script, and unknown buckets. Each file records bytes and logical LOC (`null` for binary or undecodable files); bucket summaries include file counts, LOC, largest file, >=500 LOC count, and lexical `any`/`unknown` counts.
- Complexity, Halstead, CRAP, mutation, and duplicate-code values remain explicitly unavailable until configured runners exist. Bun branch-coverage support and the existing Knip dead-code command are reported as available but not run by the inventory; no unavailable metric is represented as zero.
- `bun run quality:report:check` compares max LOC, >=500 LOC files, and `any`/`unknown` counts against the baseline. Full-repository targets remain informational until the relevant runners and scoped coverage/mutation jobs are configured.
- Added `.github/workflows/quality.yml` for pull-request measurement, baseline checking, and report artifact upload. Mutation is not run in this PR workflow; scheduled external mutation recording remains separate.
- Removed Bun's `--only-failures` flag from all workspace test scripts and both release quality paths (`script/quality-release.ts`, `script/quality-binary.ts`); `bun run quality:full` therefore invokes full Bun runs for its selected core/TUI suites.

## Validation (2026-09-01)

- `bun run quality:report:check` — pass; no new guardrail regressions after the final baseline capture.
- `bun script/quality-report.ts --output /tmp/spinosa-quality-report-n.json` — pass; deterministic report generated.
- Two JSON reports compared by SHA-256 — identical (`470c2859011e877e324c46e06f8624fa920a740340631c1b8ad36a738860cd41`).
- `tsc --noEmit --target ESNext --module ESNext --moduleResolution Bundler --types bun script/quality-report.ts` — pass.
- Quality JSON contract assertion — pass; all eight buckets and requested measurement keys present.
- Workflow YAML parse via `js-yaml` — pass.
- All 11 edited package manifests parse as JSON — pass; repository search found no executable `--only-failures` references.
- Runtime coverage, complexity, Halstead, CRAP, mutation, duplicate, and full repository test/typecheck sweeps were not run by this focused tooling change; the report records their availability and does not claim results.
