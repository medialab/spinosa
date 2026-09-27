---
type: system_architecture_map
role: framework_map
purpose:
  - describe runtime-owned workflows
  - explain bounded worker responsibilities
  - show workspace data boundaries
description: Architecture map for Spinosa runtime workflows and evidence artifacts.
scope:
  - repo-wide architecture
connects_to:
  - AGENTS.md
  - docs/diagrams.md
  - .agents/agents/
  - .spinosa/agents/
  - system/dictionary.md
  - system/workspace_index.md
created: 2026-05-26
updated: 2026-09-23
status: active
---

# System Architecture Map

Full Mermaid diagrams are in [`docs/diagrams.md`](../docs/diagrams.md).
This page summarizes the runtime contract and workspace boundaries.

## Runtime control plane

For routed Spinosa work, the WorkflowEngine and `.spinosa/runs/{run_id}/run.json`
are authoritative. The router selects a strategy from `BUILTIN_WORKFLOWS`; the
engine schedules runnable nodes, enforces dependencies, validates artifacts,
applies retries and gates, and records terminal state. A host may dispatch a
worker but does not replace runtime routing or gates.

Each worker receives one node scope, its input artifact paths, coverage
contract, permitted tools, and exact output path. It reads supplied inputs,
writes only declared artifacts, then returns path, completion status, and any
explicit coverage gap.

## Workflow roles

| Worker | Bounded responsibility |
|---|---|
| `spinosa-searcher` | Retrieve source-grounded evidence under the supplied coverage contract |
| `spinosa-mapper` | Extract assigned files or write explicitly assigned maps |
| `spinosa-analyst` | Separate supported findings, context-derived hypotheses, and retrieval questions |
| `spinosa-serendippo` | Record evidence-backed connections, alternatives, and limitations |
| `spinosa-writer` | Synthesize supplied artifacts into the assigned report path |
| `spinosa-verifier` | Check claims against supplied original sources and record a valid status |
| `spinosa-evaluator` | Audit supplied run events and process quality |
| `spinosa-evolver` | Apply a change explicitly approved by the runtime gate |
| `spinosa-janitor` | Report independent hygiene counts and propose cleanup |
| `spinosa-overseer` | Perform a coverage audit only when its runtime workflow is selected |

No role owns workflow sequencing. Coverage audits use `meta.coverage_audit`;
they are not triggered by a route-count counter. Startup never runs Overseer or
external session interception.

## Startup lifecycle

```text
not_started
  → cli_started
  → validate → survey → partition → extraction fan-out → merge → dictionary
  → header enrichment → map write → connection analysis → verification
  → evaluation → commit workspace_started
```

Optional artifacts do not silently skip a scheduled phase. Recovery validates
assigned file sets, terminal extraction statuses, metadata, and artifact
contents; a filename alone is not proof of completion. The runtime commits
`workspace_started` only after required dictionary, index, map, coverage, and
verification gates pass.

## Evidence and status semantics

- Search scope follows `opportunistic`, `sufficient`, `representative`, or
  `exhaustive`; the WorkflowEngine applies the corresponding evidence gate.
- Reports distinguish files inspected from files not observed, concepts
  mentioned from concepts not observed, and freshness evidence from staleness
  conclusions. Absence of a mention is not proof of absence.
- Verification statuses are `pass`, `pass_with_corrections`, `partial`, `fail`,
  and `blocked`. A minor discrepancy is recorded as `pass_with_corrections`
  with a note.
- `spinosa_figure` supports only `bar`, `sparkline`, `stacked_bar`, and
  `status_matrix`; unsupported chart kinds use prose or a table.

## Workspace data layers

```text
Framework instructions: AGENTS.md, startup-prompt.md, .agents/, .spinosa/agents/
Sources:                raw/ (source copies; bodies are read-only)
Navigation:             maps/ (wikilinks over the corpus)
Context and index:      system/ (configuration, dictionary, workspace index)
Run state:              .spinosa/runs/{run_id}/run.json
Artifacts:              agent_reports/ (goals, evidence, reports, verification)
Memory:                 .spinosa/memory/orchestrator-notes.md
Archive:                .trash/ (only through the approved cleanup workflow)
Logs:                   .logs/ (import and conversion traces)
```
