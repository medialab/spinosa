---
type: test
test_name: case-temporal-evolution
route: non-fast-path
expected_pipeline:
  - spinosa-searcher
  - spinosa-serendippo
  - spinosa-writer
  - spinosa-verifier
  - spinosa-evaluator
expected_gate: pass
description: Temporal evolution and serendipitous connections — tests serendippo roaming beyond keyword matches.
---

Run this through the research pipeline with serendippo: searcher finds evidence across the corpus, serendippo roams raw files to find hidden connections and temporal shifts, writer traces evolution in a report, verifier cross-checks connections, evaluator appends footer.

How have the key concepts or themes in this corpus evolved across different sources or time periods? Are there unexpected connections between sources that a surface-level search would miss? Trace the threads and identify any patterns that emerge only when reading across files holistically.
