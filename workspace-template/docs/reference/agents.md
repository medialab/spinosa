# Agents & Workflow Reference

Spinosa has two execution modes:

- `fast_path` for a direct bounded answer;
- a versioned runtime workflow for work that needs corpus evidence, artifacts,
  coverage, mutation, cleanup, or strict verification.

For routed Spinosa work, the WorkflowEngine and `run.json` are authoritative.
They select runnable nodes, enforce dependencies, apply retries and gates, and
determine terminal state. Agents execute only the supplied workflow node.

A host may provide its own worker-dispatch mechanism, but workers must not
route, dispatch, mint artifacts, choose the next phase, or reinterpret gates.

## Runtime flow

The router selects a strategy from the generated classification table. The
engine builds the workflow plan, schedules runnable nodes, supplies each node
with its scope and artifact paths, validates outputs, applies retries and
gates, and records the terminal state.

Workers do not route, dispatch, mint paths, choose the next phase, or run
coordinator controls. They read supplied inputs, use permitted tools, write
the declared artifact, and return the path, status, and coverage gaps.
The coordinator/runtime owns routing, dispatch, artifact naming, gates,
verification, retries, and evaluation.

Legacy `Q1`–`Q5` labels remain only for migration of old run records.

## Roles

| Agent | Capability | Typical output |
|---|---|---|
| Mapper | Extracts corpus fragments and writes maps | extraction packets and maps |
| Searcher | Retrieves source-grounded evidence | evidence packet |
| Analyst | Synthesizes supplied evidence and context | analysis packet |
| Serendippo | Finds evidence-backed cross-source connections | serendipity report |
| Writer | Composes a user-facing report | numbered report |
| Verifier | Checks claims, quotes, and citations | verification outcome |
| Evaluator | Audits the workflow trace | evaluation report |
| Evolver | Applies an approved framework edit | scoped evolution report |
| Janitor | Audits hygiene and proposes cleanup | cleanup proposal |
| Overseer | Audits coverage after its workflow schedules it | coverage report |

The runtime decides which roles run for a request. No role is mandatory merely
because a prose template lists it; required nodes are defined by the workflow.

## Startup

Startup is `corpus.startup_index` and runs while `setup_status: cli_started`.
The portable phase order is:

```text
validate → survey → partition → extraction fan-out → merge → dictionary
→ header enrichment → maps → connection analysis → verification → evaluation
→ commit workspace_started
```

The connection and evaluation artifacts may be optional, but their scheduled
workflow phases must not be silently omitted. Never run Overseer or external
session interception during startup.

Startup completes only when the dictionary, workspace index, required maps,
extraction coverage, and verification gates pass. A partial batch stays partial
until its exact assignment is rewritten or explicitly marked unreadable.

## Search coverage

Search behavior follows the runtime `coverage` contract:

- `opportunistic`: one useful source may satisfy the request;
- `sufficient`: support the claim or document no evidence;
- `representative`: cover every declared stratum;
- `exhaustive`: account for every partition and denominator unit.

Searchers use the host's actual search schema, inspect truncation, and record
searched scope, unsearched scope, and blockers. They must not assume shell
flags or fixed per-file match limits.

## Evidence quality

Analysts distinguish supported findings, context-derived hypotheses, and
questions requiring retrieval. Overseers distinguish file access, concept
mentions, and freshness; absence is reported as “not observed in the inspected
records” unless a complete denominator is established.

Serendippo must cite evidence from both sides of every proposed connection,
state alternative explanations, and may report no supported connection.

Quotes use the shortest passage that supports the claim, with enough context
to preserve meaning and a source location.

## Reports, verification, and figures

Valid report statuses are `pass`, `pass_with_corrections`, `partial`, `fail`,
and `blocked`. Minor discrepancies use `pass_with_corrections` plus a note.

Quantitative figures use `spinosa_figure` only with `bar`, `sparkline`,
`stacked_bar`, or `status_matrix`. Unsupported chart requests use prose or a
table; agents do not hand-render chart approximations.

Janitor reports independent counts—total files, stale files, corrupt copies,
broken links, stale entries, and orphaned files—instead of a mandatory health
gauge. Serendippo reports connection evidence and counts without unsafe
min/max normalization.

## Runtime agent files

Canonical worker guidance is in `.agents/agents/`; Spinosa's native agent
definitions, loaded by the runtime, are in `.spinosa/agents/`. Portable skills
and shared references stay in `.agents/skills/` and `.agents/references/`.
No `.opencode/` adapter tree is shipped. Legacy `.opencode/` paths migrate to
`.spinosa/` only when the destination does not already exist; conflicts are
left untouched and reported rather than overwritten.

Native sub-agent spawning, Task-like dispatch, and skill injection are host
mechanisms. They may execute a runtime-supplied node but do not replace the
WorkflowEngine's routing or gates.
