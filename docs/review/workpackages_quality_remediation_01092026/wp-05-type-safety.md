# WP-05 Type safety boundaries [Status: Done 2026-09-01]

## Goal

Remove unsafe broad types from handwritten code and validate untrusted data at ingress.

## Work

1. Track every occurrence from the complete any/unknown inventory; never hide generated debt silently.
2. core/src/tool/custom.ts:50-246: accept unknown, guard JSON Schema/Zod inputs, return one typed dynamic-schema wrapper.
3. Effect/Drizzle effect files: isolate compatibility casts, remove blanket lint suppression, test Bun/Node parity.
4. kernel util/rpc.ts, lsp/{lsp,client}.ts, bus/global.ts: typed method maps, wire envelopes, LSP unions, and event payload maps.
5. plugin index/tool/shell and v2/promise/aisdk: type plugin payloads and decode at host boundary.
6. Replace broad SDK/provider/UI casts with schemas, discriminated unions, and named conversion functions.

## Acceptance

No unreviewed handwritten production any/unknown remains. Retained casts are isolated, named, tested, and listed. Typecheck passes without new suppressions.

## Implementation status (2026-09-01)

- [Status: Done 2026-09-01] Focused custom-tool schema-ingress slice completed.
- `packages/core/src/tool/custom.ts`: removed local `any`/broad assertions; added structural guards for plugin, JSON Schema, and Zod-like values; bounded recursive Zod traversal; retained intentional `Schema.Unknown` fallback for unsupported object/union schemas.
- `packages/core/test/tool-custom.test.ts`: added direct registration/settlement coverage for malformed `_zod`, unsupported object schemas, cyclic arrays, non-record args, and invalid converted input.
- Remaining inventory items (Effect/Drizzle compatibility boundaries, kernel RPC/LSP/bus, plugin/provider/SDK/UI casts) remain separate follow-up work and are not represented as changed here.

## Recommendation rationale

- Validate external tool modules at the ingress boundary and preserve `unknown` until structural guards establish shape (`skills/coding/SKILL.md`, input-validation and error-handling rules).
- Use a named dynamic-schema wrapper instead of repeated broad assertions; bound recursive traversal to prevent malformed plugin data from exhausting the process.
- Mitigates long-method/duplicate-code and speculative-generality risks without adding fallback shims: `skills/coding/references/code-smells/smells/long-method.md`, `skills/coding/references/code-smells/smells/duplicate-code.md`, `skills/coding/references/code-smells/smells/speculative-generality.md`, `skills/coding/references/code-smells/smells/codex-code-smell.md`.

## Proof / validation

- `rtk bun run --cwd packages/core typecheck` — pass (`tsc --noEmit`).
- `rtk bun test --cwd packages/core test/tool-custom.test.ts` — 2 pass, 0 fail, 6 expectations.

## How test

The focused test writes an isolated `.spinosa/tools/ingress.js` fixture into a temporary project, builds the real `ToolRegistry`/`CustomTools` node graph, registers malformed and recursive schema definitions, settles valid calls, and asserts model-visible rejection for a string schema supplied a number.
