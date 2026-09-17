# WP-06 Duplication and SDK/tool contracts [Status: In Progress 2026-09-01]

## Goal

Remove duplicated behavior without creating another universal abstraction.

## Work

1. Decide whether packages/sdk/src/gen/** and packages/sdk/src/v2/gen/** are both contractual. Share handwritten client/SSE/serializer/error runtime; keep generated models/endpoints separate.
2. Fix packages/sdk/script/build.ts:74-122 so generator input owns transformations; make output idempotent and diff-checkable.
3. Consolidate runReinstall in onboarding/add-files and wrapSSE in kernel provider/core AISDK after tests lock error semantics.
4. Choose canonical executable tool representation across core/src/tool/tool.ts, llm/src/tool.ts, and spinosa-kernel/src/tool/tool.ts. Migrate LLM → kernel → plugins/TUI.
5. Share V1/V2 normalization and TUI dialog scaffolding only where semantics match.

## Acceptance

One implementation owns each shared behavior. Generated output is deterministic. Focused SDK compatibility tests pass; tool-contract compatibility remains gated on the deferred migration.

## Recommendation rationale

- Keep `packages/sdk/src/gen/**` and `packages/sdk/src/v2/gen/**` generator-owned and separate. The shared handwritten transport rule belongs in `packages/sdk/src/location.ts`, with explicit V1/V2 options for the differences in workspace and API query handling. This applies DRY/SRP without creating a universal generated-model abstraction (`duplicate-code.md`, `alternative-classes-with-different-interfaces.md`).
- Keep the SSE timeout primitive in `packages/core/src/sse.ts`. Core supplies generic timeout errors; the kernel supplies `ProviderError.ResponseStreamError` through the error factory, so transport reuse does not erase provider-facing error semantics.
- Keep reinstall orchestration in `packages/tui/src/spinosa/reinstall.ts`; onboarding and add-files provide only route-specific callbacks. Output cleaning, timeout handling, process result mapping, and the installer arguments now have one owner.
- Treat the current executable-tool types as bounded contracts: `@spinosa/llm` remains provider-facing, Core owns opaque application-tool registration, and the kernel owns session/permission-aware execution. Do not add a compatibility shim or collapse these boundaries until a separately tested migration is designed (`codex-code-smell.md`, `speculative-generality.md`).

## Implementation status (2026-09-01)

- [Status: In Progress 2026-09-01] Completed the safe duplication consolidations in `packages/tui/src/spinosa/reinstall.ts`, `packages/core/src/sse.ts`, and `packages/sdk/src/location.ts`; updated both TUI routes, Core AISDK, kernel provider loading, and SDK V1/V2 clients to use the shared primitives.
- Updated `packages/sdk/script/build.ts` so history and SSE generated-output patches accept the generator's semicolon/no-semicolon shapes, verify already-patched output, and fail clearly when the expected generated contract changes.
- Added focused regression coverage in `packages/tui/test/spinosa/reinstall.test.ts`, `packages/core/test/sse.test.ts`, and `packages/sdk/test/location-headers.test.ts`.
- The tool-contract migration in Work item 4 is intentionally deferred. No cross-layer type or execution adapter was introduced; the existing provider, application-tool, and kernel session/permission boundaries remain unchanged pending a compatibility-test plan.

## Why works

Each duplicated behavior now has one handwritten implementation. The SDK helper exposes the V1/V2 differences as options instead of copying header/query normalization; the SSE helper accepts an error factory instead of importing provider-specific errors into Core; and the TUI helper accepts output callbacks instead of duplicating process lifecycle code. Generated files remain separate and generator-owned, while the build guard is idempotent for both generated formatting variants.

## Proof / validation

- `rtk bun test test/sse.test.ts` from `packages/core` — **2 pass, 0 fail**.
- `rtk bun test test/spinosa/reinstall.test.ts` from `packages/tui` — **2 pass, 0 fail**.
- `rtk bun test test/location-headers.test.ts` from `packages/sdk` — **3 pass, 0 fail**.
- `rtk bun test test/provider/header-timeout.test.ts` from `packages/spinosa-kernel` — **6 pass, 0 fail**; provider-specific stream timeout semantics remain intact.
- `rtk bun run build` from `packages/sdk` — **pass**. Generator-only formatting drift produced during this check was restored; no generated drift is retained in the WP-06 change.
- `rtk bun run typecheck` from `packages/sdk` and `packages/core` — **pass**. Kernel typecheck still reports the shared-worktree errors in `src/agent/agent.ts`, `src/session/llm*.ts`, `src/session/message-v2.ts`, `test/provider/cf-ai-gateway-e2e.test.ts`, and TUI files; none points at the touched provider timeout path.
- `rtk git diff --check` on the WP-06 files — pass.

## How to test

```sh
cd packages/core && bun test test/sse.test.ts
cd ../tui && bun test test/spinosa/reinstall.test.ts
cd ../sdk && bun test test/location-headers.test.ts && bun run build
cd ../spinosa-kernel && bun test test/provider/header-timeout.test.ts
```

## Deferred tool-contract migration

The canonical executable-tool representation is not selected by this checkpoint. A safe follow-up must first define the shared input schema, execution context, output/attachment metadata, validation-error semantics, and session/permission lifecycle, then add compatibility tests across LLM, kernel, Core, plugins, and TUI. Until that evidence exists, retaining the existing contracts is the non-destructive choice and avoids a speculative universal abstraction.
