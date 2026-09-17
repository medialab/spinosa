# WP-09 Generated data, slop, and file hygiene [Status: In Progress]

## Goal

Separate generated/data bulk from handwritten logic and remove avoidable complexity signals.

## Work

1. Classify SDK output, template packs, permission data, giant JSON fixtures, assets, docs, and scripts in the metric policy.
2. Keep generated files generator-owned; add freshness and provenance checks.
3. Replace embedded Generated following prompt content in packages/spinosa-kernel/src/permission/arity.ts with versioned data where safe.
4. Remove unresolved MUST FIX and unprofessional TODO comments after fixing the underlying path.
5. Remove defensive JSON probing, one-use wrappers, and speculative abstractions only after behavior review.
6. Split handwritten files over 500 LOC and oversized tests by responsibility.

## Evidence (2026-09-01)

- Added `script/check-generated.ts`, wired as `quality:generated`. It recomputes the workspace-template pack ID from the manifest, checks version/file-count metadata, validates generated module entries and blob/import sets, and requires provenance headers in SDK and kernel generated roots.
- The checker also validates the versioned arity-data marker and rejects the removed embedded generator prompt plus vague `MUST FIX`/cleanup TODO markers in production source. `packages/spinosa-kernel/src/permission/arity.ts` keeps the same dictionary and now carries `@generated-data version=2026-09-01`; the parser, provider-boundary, and pricing comments are explicit. The remaining tree-sitter-nix TODO is an actionable upstream dependency note.
- `bun run quality:generated` passes: template pack/header/arity/source-marker checks pass, followed by `packages/core` migration freshness (`No schema changes, nothing to migrate`; generated SQL migration succeeds).
- SDK generated output (`packages/sdk/src/gen`, `packages/sdk/src/v2/gen`), kernel generated output, template blobs, and database migration output remain generator-owned. No generated file was hand-edited.

## Remaining

Complete the broader fixture/asset/docs classification and the >500 LOC handwritten-file review; split files only where responsibility boundaries are demonstrated.

## Acceptance

Generated/data files have owners and freshness checks. Handwritten inventory meets policy. No behavior is hidden through exclusions.
