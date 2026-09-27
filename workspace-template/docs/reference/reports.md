# Reports and Figures

The selected runtime workflow determines which report nodes run, their input
artifacts, exact output paths, verification gates, and terminal status. The
WorkflowEngine records progress in `.spinosa/runs/{run_id}/run.json`.

## Report contents

- State the question and answer in plain language.
- Ground factual claims in approved source paths and locations.
- Quote the shortest passage that supports a claim, retaining enough context
  to preserve its meaning.
- Separate supported findings from context-derived hypotheses and questions
  that still require retrieval.
- State searched scope, unsearched scope, truncation, and blockers when search
  coverage is part of the workflow.
- Report absence as “not observed in the inspected records” unless the workflow
  establishes a complete denominator.

## Verification status

The valid statuses are `pass`, `pass_with_corrections`, `partial`, `fail`, and
`blocked`. Record a minor discrepancy as `pass_with_corrections` with a note.
The runtime applies the verification result to the run's gates and terminal
state.

## Supported figure capabilities

Figures are created through `spinosa_figure`. The supported kinds are:

| Kind | Use for |
|---|---|
| `bar` | Comparing named values |
| `sparkline` | A short ordered trend |
| `stacked_bar` | Composition of a total |
| `status_matrix` | Independent status cells |

Scatter plots, density plots, histograms, ridge plots, heatmaps, gauges, and
other kinds are unavailable. Use prose or a Markdown table for those requests;
do not hand-render chart approximations.

## Artifact paths and delivery

Use the exact artifact paths supplied by the runtime node. The runtime assigns
numbered report names and intermediate paths; workers do not mint or rename
them. When a workflow produces a verified report, give the user its path and
status. Keep the report body in the artifact unless the user asks for an inline
summary.
