---
type: directory_guidance
scope: tests/pipeline/
description: |
  Self-contained test files for the Spinosa research pipeline.
  Each file has YAML frontmatter (expectations) + a prompt body
  that includes pipeline instructions and the research query.
connects_to:
  - AGENTS.md
created: 2026-06-30
updated: 2026-06-30
---

# tests/pipeline/ — Pipeline Test Suite

Each file is a self-contained test: YAML frontmatter declares what's
expected, the prompt body tells the orchestrator which pipeline to
run and what question to answer.

## How to run a test

1. Read the test file.
2. Execute the entire prompt body as a **non-fast-path** route.
3. After the pipeline completes, compare the final report's `status`
   against `expected_gate` in the file's YAML.
4. Report: pass/fail, actual gate, and any divergences from
   `expected_pipeline`.

## Recommended sequence

Run in order. Audit depends on session logs from the four cases.

```
1. case-research-query.md
2. case-gap-analysis.md
3. case-cross-source-synthesis.md
4. case-temporal-evolution.md
5. audit-pipeline-fidelity.md (requires 1-4 to have run first)
```

## Gate expectations

| expected_gate | Meaning |
|---|---|
| `pass` | All claims verified, all steps completed |
| `pass_with_corrections` | Minor fixes by verifier, report usable |
| `partial` | Some claims unresolved |
| `fail` | Claims don't hold |

## Rules

- Do not modify test files.
- Do not fabricate results — report actual gate status honestly.
- If actual gate < expected gate, document why.
