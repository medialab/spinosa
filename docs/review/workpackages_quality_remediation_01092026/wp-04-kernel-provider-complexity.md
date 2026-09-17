# WP-04 Kernel and provider complexity [Status: In Progress 2026-09-01]

## Goal

Separate lifecycle, protocol, state, and rendering responsibilities in kernel run and provider paths.

## Work

1. footer.prompt.tsx:281: split prompt reducer, effect runner, and view projection.
2. stream.transport.ts:391: split request config, stream adapter, retry/error policy, event commit, and finalizer; preserve Effect scope and abort semantics.
3. runtime.ts:180, runtime.queue.ts:58, session-data.ts:772: isolate queue, lifecycle, and event reducer.
4. Split footer.view.tsx:117, footer.question.tsx:47, and footer.permission.tsx:132 into state projections and small renderers.
5. provider/transform.ts:64,672,1074,1335,1418: use one typed recursive traversal and explicit provider callbacks; remove obsolete code.
6. provider/provider.ts:167 and loader region 1644–1835: explicit descriptors/factories, dynamic import guards, typed options, and error mapping.
7. Test empty streams, malformed events, retry/abort/timeout, cleanup ordering, cache/auth/options, and Layer acquire/release.

## Acceptance

Extracted handwritten functions meet thresholds. Transport/provider terminal and error paths are covered. Public behavior stays unchanged.

## Implementation status (2026-09-01)

- [Status: Done 2026-09-01] Provider transform slice completed in `packages/spinosa-kernel/src/provider/transform.ts`.
- Consolidated the duplicated Anthropic/Bedrock empty-content filter behind a typed provider selector.
- Replaced the three schema sanitizers' repeated array/object recursion with one typed `walkSchema` traversal and provider-specific object visitors.
- Removed the obsolete commented-out schema branch and the duplicate local `isPlainObject` helper.
- Transport/runtime and provider loader items remain in progress for the parent WP-04 execution.

## Recommendation rationale

The refactor follows `skills/coding/SKILL.md`, `skills/coding/references/code-smells/smells/long-method.md`, `skills/coding/references/code-smells/smells/duplicate-code.md`, and `skills/coding/references/code-smells/smells/dead-code.md`: shared traversal/filter primitives remove duplicate control flow while keeping provider-specific behavior in explicit callbacks. The change is non-destructive and retains the existing schema compatibility rules.

## Proof / validation

- `bun test test/provider/transform.test.ts` from `packages/spinosa-kernel`: **290 pass, 0 fail**.
- `bunx prettier --no-semi --print-width 120 --check packages/spinosa-kernel/src/provider/transform.ts`: passed.
- `git diff --check -- packages/spinosa-kernel/src/provider/transform.ts`: passed.
- `tsc --noEmit` from `packages/spinosa-kernel`: currently reports five shared-worktree type errors in `src/agent/agent.ts`, `src/session/llm.ts`, `src/session/llm/native-runtime.ts`, and `test/provider/cf-ai-gateway-e2e.test.ts`; no errors remain in `src/provider/transform.ts`.

## How to test

```sh
cd packages/spinosa-kernel
bun test test/provider/transform.test.ts
tsc --noEmit
```
