---
type: test
test_name: case-research-query
route: non-fast-path
expected_pipeline:
  - spinosa-searcher
  - spinosa-writer
  - spinosa-verifier
  - spinosa-evaluator
expected_gate: pass
description: Standard research query — core pipeline.
---

Run this through the full research pipeline: searcher finds evidence, writer synthesizes a report, verifier checks claims, evaluator appends provenance footer and cleans up.

What does the corpus tell us about the main research themes or topics covered in the raw files? Summarize the key concepts, list the sources found, and identify any notable gaps in coverage.
