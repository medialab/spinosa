---
type: test
test_name: case-cross-source-synthesis
route: non-fast-path
expected_pipeline:
  - spinosa-searcher
  - spinosa-analyst
  - spinosa-writer
  - spinosa-verifier
  - spinosa-evaluator
expected_gate: pass
description: Cross-source synthesis — tests multi-source search and analyst-driven pattern identification.
---

Run this through the research pipeline with the analyst: searcher finds evidence across multiple raw files, analyst identifies cross-cutting patterns/tensions/contradictions, writer synthesizes drawing from ≥2 distinct sources, verifier checks claims per source, evaluator appends footer.

Compare and contrast the different perspectives or approaches present across the corpus. Are there tensions, contradictions, or complementary viewpoints between different sources? Synthesize what each source contributes and where they disagree or reinforce each other.
