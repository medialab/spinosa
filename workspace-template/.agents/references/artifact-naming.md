# Artifact Paths and Names

The WorkflowEngine supplies each node with its exact output path. Workers write
to that path and never mint, choose, or rename artifact paths. These conventions
describe human-readable names for workflow definitions and review; they do not
override a supplied path.

## User-facing reports

When a workflow requests a numbered report, use the exact runtime-supplied
filename. Human-readable topic slugs use lowercase kebab-case and describe the
question or operation rather than the worker or file type.

| Avoid as the whole slug | Prefer |
|---|---|
| `report`, `output`, `final`, `temp` | `coastal-erosion-normandy-interviews` |
| `analysis`, `draft`, `misc` | `fisheries-policy-source-comparison` |

## Common workflow path patterns

The patterns below document current examples. The runtime node's `expectedArtifacts`
entry remains authoritative when a workflow uses a different path.

| Artifact | Example pattern |
|---|---|
| Goal mirror | `agent_reports/g_{run_id}.md` |
| Evidence packet | `agent_reports/evidence_packet_{run_id}.md` |
| Analysis | `agent_reports/analysis_{run_id}.md` |
| Serendipity | `agent_reports/serendipity_{run_id}.md` |
| Evaluation | `agent_reports/e_{run_id}.md` |
| Coverage audit | `agent_reports/c_{run_id}.md` |
| Janitor proposal | runtime-supplied report path |
| Numbered report | runtime-supplied `NN_*.md` path |

If a workflow schedules parallel workers, the runtime supplies a distinct
output path to each node.

## Extraction batches and maps

The runtime supplies the descriptive extraction `batch_id` and output path. Use
the complete assigned file list with `spinosa_map`; do not infer that a batch is
complete from its filename. Valid terminal file statuses are `extracted` and
`unreadable`.

For map-writing nodes, use the exact `maps/...` path supplied by the runtime.
Map slugs should describe a corpus group or cross-cutting theme.
