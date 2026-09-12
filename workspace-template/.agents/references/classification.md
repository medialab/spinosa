# Prompt Routing Split (generated — do not hand-edit)

Source of truth: `packages/spinosa-runtime/src/workflows/`.
Regenerate with `renderWorkflowTable()` in `packages/spinosa-runtime/src/documentation.ts`.

## Fast vs orchestrated

A request is **fast** when it completes correctly as one bounded operation:
explain a term, summarize one selected document, retrieve one quoted passage,
convert a supplied table, plot a few values.

A request is **orchestrated** when correctness depends on corpus-wide coverage,
multiple partitions, cohort balance, completeness claims, comparative synthesis,
hypothesis testing, hidden-pattern discovery, persistent artifacts, multiple
cognitive operations, mutation or approval, strict source verification, or
indexing/remapping. Response length does not determine the mode.

## Workflow registry

| Workflow | Version |
| -------- | ------- |
| `research.targeted_evidence` | v1 |
| `research.contextual_synthesis` | v1 |
| `research.corpus_census` | v1 |
| `research.comparative_synthesis` | v1 |
| `research.hypothesis_test` | v1 |
| `research.exploratory_discovery` | v1 |
| `corpus.startup_index` | v1 |
| `corpus.add_sources` | v1 |
| `maintenance.cleanup_proposal` | v1 |
| `maintenance.cleanup_apply` | v1 |
| `meta.coverage_audit` | v1 |
| `meta.framework_evolution` | v1 |

## Notes

- **Startup indexing** (`corpus.startup_index`) runs while `setup_status` is
  `cli_started` or on explicit startup handoff. Never `spinosa-overseer`.
- **Coverage audit** (`meta.coverage_audit`) runs only after
  `workspace_started`, on user request or coverage triggers.
- **Cleanup** never mutates without an explicit approval transition.
- **Serendippo vs Analyst:** Analyst organizes evidence the Searcher already
  found. Serendippo roams `raw/` for connections Searcher did not surface.
