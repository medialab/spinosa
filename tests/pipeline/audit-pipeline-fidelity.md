---
type: test
test_name: audit-pipeline-fidelity
route: non-fast-path
expected_pipeline:
  - skill: agent-interception
  - spinosa-writer
  - spinosa-verifier
  - spinosa-evaluator
dependencies:
  - case-research-query
  - case-gap-analysis
  - case-cross-source-synthesis
  - case-temporal-evolution
expected_gate: pass
description: Post-hoc pipeline audit — checks sub-agent dispatch order and artifact cleanup from the 4 case study session logs.
---

Run this as a pipeline audit after the four case studies complete. Load the agent-interception skill and extract tool traces from the OpenCode session logs of those runs.

For each of the four case study runs (case-research-query, case-gap-analysis, case-cross-source-synthesis, case-temporal-evolution):
1. Which sub-agents were dispatched, and in what order?
2. Did the actual sequence match the expected_pipeline in the test's YAML frontmatter?
3. Any divergences — agents called when not expected, skipped steps, out-of-order execution?
4. Were intermediate artifacts (evidence_packet.md, g_{session_id}.md, a_{session_id}.md) moved to .trash/ after evaluator completed?

Write a fidelity report covering all four cases with an overall score: pass / pass_with_minor_issues / fail. Verifier checks every claim against the extracted logs.
