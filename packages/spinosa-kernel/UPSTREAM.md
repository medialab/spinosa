# Inherited kernel: anomalco/opencode

- Source commit: `7b25f9e58d448b2d7b320902a870c7458c6e899a`
- Source version: v1.17.12
- Imported: 2026-06 through `git filter-repo`
- Licence: MIT; retain applicable third-party notices with release artifacts.

This directory is Spinosa-owned inherited infrastructure. It supplies the mature
session, model, tool, MCP, permission, server, and terminal primitives used by
Spinosa. It is not an upstream-managed subtree and has no upstream-sync or
source-compatibility obligation.

## Dependency boundary

```text
Spinosa UI / CLI
  -> Spinosa core and runtime
  -> inherited kernel packages
```

- `@spinosa/kernel-core` and `@spinosa/runtime` must not import `@spinosa/*`.
- Kernel changes are permitted when they serve Spinosa, while retaining source
  attribution and licence notices.
- Do not reintroduce subtree-pull instructions or an upstream compatibility
  policy without a deliberate product decision.

The public product entrypoint is `packages/spinosa-cli/src/index.ts`; inherited
CLI code remains internal implementation until a Spinosa-owned command needs to
replace it.
