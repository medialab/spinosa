# WP-03 TUI complexity [Status: In Progress 2026-09-02]

## Goal

Reduce branch and responsibility overload while preserving route, keyboard, and public component contracts.

## Work

1. onboarding.tsx:227: extract typed state machine, source/path validation, tool controller, import orchestration, provider finalization, and thin view. Preserve cancellation, timeout, stdout/stderr, and child-kill behavior.
2. prompt/index.tsx:163: extract editor state, command palette, submit decision, attachments, and view. Keep Prompt, PromptProps, and PromptRef stable.
3. routes/session/index.tsx:218: split session state/commands/navigation, transcript rows, and view. Keep route and prompt integration stable.
4. routes/spinosa/add-files.tsx:166: separate discovery, selection, processing, filesystem/process effects, and view. Share only proven installer primitives.
5. ui/dialog-select.tsx:79: extract typed selection model and navigation reducer; retain caller policy.
6. feature-plugins/system/diff-viewer.tsx:91: split data normalization, review reducer, and panels.
7. Add tests before each split. Enforce C<22, cognitive<22, LOC<500, measured CRAP<25.

## Acceptance

Route behavior and intentional snapshots remain stable. Pure reducers have full branch coverage and zero survivors. No new kernel-core imports enter TUI.

## Progress: 2026-09-01

Completed in this slice:

- `packages/ui/src/theme/resolve.ts` is now a thin public API wrapper; `resolve-variant.ts` owns typed resolution context and scale construction; `resolve-tokens.ts` owns token-group builders.
- `packages/ui/src/theme/resolve.test.ts` covers seed light/dark variants, compact palette fallback and overrides, public `resolveTheme`, and `themeToCss`.
- `packages/tui/src/ui/dialog-select.tsx` delegates filtering, grouping, flattening, row counting, and selection wrapping to typed pure helpers in `dialog-select-model.ts`.
- `packages/tui/test/ui/dialog-select-model.test.ts` covers filtering, grouping/flattening, row counting, and navigation wrapping.
- `packages/ui/src/theme/resolve-tokens.ts` now keeps background/surface/text/border assembly under 500 lines; semantic icon/syntax/avatar groups live in `resolve-token-semantic.ts`, and shared color selection lives in `resolve-token-helpers.ts`.
- Compact-light icon resolution retains its pre-override text-token dependency; `packages/ui/src/theme/resolve.test.ts` covers that regression.

The extractions reduce component responsibility and isolate branch-heavy data transforms from rendering/effect orchestration. Existing behavior was preserved, including the dark-theme lightness branch and DialogSelect title-weighted fuzzy matching.

Validation:

- `bun run --cwd packages/ui typecheck` passed.
- `bun run --cwd packages/ui test` passed: 8 tests, 62 expectations.
- `bun run --cwd packages/tui test -- test/ui/dialog-select-model.test.ts` passed: 4 tests, 10 expectations.
- `bun run --cwd packages/tui typecheck` remains blocked by pre-existing strict-index/type errors across `packages/core` and unrelated TUI sources/tests; no errors remain in the changed DialogSelect model/test paths after the tuple and index guards.

Remaining hotspots:

- Remaining TUI complexity work is concentrated in route/component builders, not theme token assembly.
- The DialogSelect component still needs renderer/effect decomposition after the pure model extraction.
- No OpenTUI component integration test exists yet.
- Onboarding, prompt, session, add-files, and diff-viewer remain untouched by this slice.
