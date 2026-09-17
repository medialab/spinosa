---
type: test
test_name: case-gap-analysis
route: non-fast-path
expected_pipeline:
  - spinosa-searcher
  - spinosa-writer
  - spinosa-verifier
  - spinosa-evaluator
expected_gate: pass_with_corrections
description: Edge case — query about something unlikely to be in the corpus. Tests graceful zero-match handling.
---

Run this through the research pipeline: searcher searches the corpus (expects zero results), writer produces an honest "no evidence found" report, verifier checks no fabricated sources, evaluator appends footer with failed search terms.

What specific pricing and subscription model does the platform use for API access? List the exact per-request or per-token costs for each tier, with source citations.
