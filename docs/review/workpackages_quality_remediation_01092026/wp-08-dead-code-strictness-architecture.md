# WP-08 Dead code, strictness, and architecture drift [Status: In Progress]

## Goal

Make unused code, compiler gaps, package ownership, and migration drift visible and removable.

## Work

1. Expand Knip beyond current ignores. Classify unused-import candidates and strict-unused diagnostics before removal.
2. Confirm launchForCli, wrapSSE, timeoutController, and modelSuggestions call sites.
3. Remove noCheck from packages/spinosa-cli/tsconfig.json. Enable noUncheckedIndexedAccess. Reduce skipLibCheck.
4. Expand dependency-cruiser to every production package and add cycle/ownership rules. Document syncpack exceptions.
5. Define ownership for packages/core, packages/spinosa-core, SDK, TUI, plugins, and kernel layers.
6. Replace hard-coded DB, trace, debug temp, and unguarded port paths.
7. Classify intentional OpenCode compatibility aliases and assign removal dates.

## Evidence (2026-09-01)

- `knip.json` now models the root and package workspace entrypoints explicitly. The seven previously exposed package scripts are classified as manual tooling entrypoints; `bun run lint:unused` passes with no findings.
- `lint:deps` now cruises `packages/*/src` plus `script`. `.dependency-cruiser.cjs` enforces product-package cycle freedom, keeps `packages/core` away from executable product hosts, and preserves the existing server/TUI and release-script boundaries. `bun run lint:deps` passes: 2,430 modules and 9,022 dependencies.
- Call-site search confirms `wrapSSE`, `timeoutController`, and `modelSuggestions` have live definitions and uses in the core/kernel provider path. No source deletion was justified from the current evidence.
- `packages/spinosa-cli/tsconfig.json` remains `strict` but still has `noCheck`; the TUI/core configs still explicitly set `noUncheckedIndexedAccess: false`. A strict-unused diagnostic remains noisy in existing source paths, so these switches stay a follow-up rather than a blind gate.
- `bunx tsc --noEmit -p packages/spinosa-core/tsconfig.json --skipLibCheck false` is currently blocked by the dependency-library `lib.dom.d.ts`/`@types/node` `TextDecoder`/`TextEncoder` conflicts (TS2430).

## Remaining

Remove `noCheck` and enable indexed-access checking after the existing diagnostics are repaired; then reduce `skipLibCheck`. Review hard-coded paths and compatibility aliases with owners and removal dates.

## Acceptance

Dead-code reports cover all paths. Strictness increases without suppressions. Dependency rules and migration aliases are documented and checked.
