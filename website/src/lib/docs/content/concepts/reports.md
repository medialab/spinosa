# Reports and Evidence

Simple requests may receive a direct answer in the chat. Research workflows that need evidence or analysis can produce a durable report in `agent_reports/`.

## Read the report

Look for the answer, quoted evidence, source paths, analysis, and limitations. Open important source files and check the quoted passage in context. The report status summarizes the workflow's checks; it is not a guarantee of completeness or correctness.

## Report statuses

| Status                  | Meaning                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `pass`                  | All claims were verified; no corrections were needed.                                        |
| `pass_with_corrections` | Minor errors were corrected; the report is usable with those changes.                        |
| `partial`               | Some claims were supported, but missing sources or unresolved questions prevent a full pass. |
| `fail`                  | Important claims did not hold against the sources; do not treat them as established.         |
| `blocked`               | The workflow could not open a source or a required source path was missing.                  |

## Charts

When a research workflow requests a chart, Spinosa can include a text-based figure in the report. Supported forms are bars, sparklines, stacked bars, and status matrices. Check each chart's units and source notes before interpreting it.

See [Agents and Workflows](/docs/agents) for how checks are selected and [Workspace Structure](/docs/workspace) for where reports are saved.
