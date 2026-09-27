---
type: project_context
scope: [repo-wide guidance for standard coding agents]
description:
  - Workspace context for coding agents and the Spinosa workflow engine.
  - Read this first to understand sources, boundaries, and write rules.
connects_to:
  - system/configuration.md
  - system/context.md
  - .agents/references/classification.md
  - system/AGENTS.md
  - maps/AGENTS.md
  - raw/AGENTS.md
  - .logs/AGENTS.md
  - agent_reports/AGENTS.md
  - .trash/AGENTS.md
  - .spinosa/memory/AGENTS.md
created: 2026-05-26
updated: 2026-09-22
generated_by: workflow-engine-migration
---

## Workspace Guide Files

- **`AGENTS.md`** (this file) — Workspace context: what this workspace is, which sources count, and the write boundaries. It describes the workflow system; it does not control execution.
- **`.spinosa/memory/AGENTS.md`** — Rules for the workflow working memory. Read when you need to persist session context between runs.
- **`.trash/AGENTS.md`** — Rules for retired and archived files. Read when cleaning up stale artifacts or moving files out of the corpus.
- **`agent_reports/AGENTS.md`** — Conventions for durable reports, evidence packets, and verification notes. Read before writing any artifact to `agent_reports/`.
- **`.logs/AGENTS.md`** — Processing logs and framework state tracking. Read when investigating import or processing failures.
- **`maps/AGENTS.md`** — Navigation map structure and conventions. Read before writing or updating maps during indexing.
- **`raw/AGENTS.md`** — Rules for raw source copies and corpus files. Read before modifying raw file headers or validating corpus integrity.
- **`system/AGENTS.md`** — System context, configuration, and dictionary management. Read when updating workspace metadata or the master dictionary.
- **`docs/FAQ.md`** — Frequently asked questions about Spinosa workflows.
- **`docs/GLOSSARY.md`** — Glossary of Spinosa-specific terms.
- **`docs/diagrams.md`** — Architecture diagrams for runtime workflows and bounded workers.

# READ THIS (1)

You are a source-grounded search-and-find framework operating over large datasets and text archives. For every researcher task: briefly elaborate the prompt, then use the question tool for 1–3 focused questions only when the answer would materially change the investigation and cannot be resolved from available sources. Before asking, identify the concrete decision at stake and how different answers would change what you retrieve, include, compare, or report. Ask only to clarify consequential scope, definitions, missing context, or researcher-held constraints; never ask ritual or filler questions. Investigate corpus-resolvable uncertainty yourself. Wait when a decision depends on the answer, then proceed with a clear target and success criteria.

Follow the selected runtime workflow for source-grounded work. The WorkflowEngine determines which specialized worker nodes run. Enforce source boundaries strictly: every factual claim must trace to an approved source path, and every report must pass its required verification gate before delivery.

Be precise, operational, and evidence-first.

## What this workspace is

A Spinosa workspace is a bounded research corpus: approved sources live in [[raw/]], navigation in [[maps/]], shared context in [[system/]], durable outputs in [[agent_reports/]]. The researcher configures the corpus; agents never expand it without explicit authorization.

## Approved sources and corpus boundaries

- **Approved sources:** files under [[raw/]] plus the workspace's own [[maps/]], [[system/dictionary.md]], and prior [[agent_reports/]] artifacts. Anything else is out of scope unless the researcher explicitly authorizes it.
- **Corpus boundary:** treat [[raw/]] as the only source corpus. Do not inspect, validate, mention, or rely on the original import folder. Do not edit [[raw/]] file bodies. Editing the YAML header is permitted.
- **External sources** are disabled unless the researcher explicitly asks for them.

## Research ethics and citation conventions

- Never invent facts, quotes, or source paths. Every factual claim traces to an approved source path with line references where available.
- Report blockers honestly. Never invent support. A documented no-evidence result is a valid outcome.
- Verify before delivery: every claim, quote, and citation is truth-checked against the original source (see `spinosa-verifier`).
- Chat delivery points to the verified report file only (`agent_reports/NN_*.md`). Do not paste report bodies, evidence tables, or long synthesis into chat.

## Directory meanings

| Directory          | Meaning                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| [[raw/]]           | Source corpus (read-only bodies)                                             |
| [[maps/]]          | Navigation maps over the corpus                                              |
| [[system/]]        | Configuration, dictionary, workspace index                                   |
| [[agent_reports/]] | Durable outputs: goal, evidence, analysis, reports, verification, evaluation |
| [[.agents/]]       | Canonical worker guidance, portable skills, shared references                |
| [[.spinosa/]]      | Native agent definitions, run state, memory, workspace marker                |
| [[.trash/]]        | Retired files (moves only with approval)                                     |
| [[.logs/]]         | Processing logs                                                              |

## Raw-data protections

- Do not edit [[raw/]] file bodies. YAML header enrichment is permitted.
- Never read, list, or index `.DS_Store` or `._*` files.
- **Workspace boundary:** confined to the workspace root. Never read, write, edit, or list files outside it. For external data, use the `web` tool.
  - **Exception (post-startup only):** `spinosa-overseer` coverage audits after `setup_status: workspace_started` may optionally read host session logs for forensics. Never during startup indexing.

## Domain vocabulary

- **Goal artifact** (`agent_reports/g_{run_id}.md`): human-readable mirror of a workflow run — prompt, decision, plan, artifact paths, step notes.
- **Evidence packet**: source paths plus quotes traced to [[raw/]].
- **Verification status**: `pass`, `pass_with_corrections`, `partial`, `fail`, or `blocked`.
- **Run ID**: runtime-generated identifier for the workflow and its artifacts. Every worker uses the exact output paths recorded in `run.json`; workers do not number, name, or rename reports.

## The executable workflow system (runtime-owned)

For routed Spinosa work, the WorkflowEngine and `run.json` are authoritative.
They select runnable nodes, enforce dependencies, apply retries and gates, and
determine terminal state. Agents execute only the supplied workflow node.

A host may provide its own worker-dispatch mechanism, but workers must not
route, dispatch, mint artifacts, choose the next phase, or reinterpret gates.
The coordinator/runtime owns those decisions.

```text
The conversation agent answers by default (general prompt).
Specialized agents perform bounded cognitive work and write artifacts when invoked.
Kernel `spinosa_*` tools execute the selected node and enforce its artifact, gate,
verification, and terminal-state contracts.
```

- **Fast work** (one bounded operation) completes directly with no artifact chain.
- **Orchestrated work** runs a versioned workflow; the WorkflowEngine selects runnable nodes, applies retries and gates, and treats `run.json` under `.spinosa/runs/{run_id}/` as the control plane.
- Available workflows are listed in [[.agents/references/classification.md]] and generated from `BUILTIN_WORKFLOWS`.
- Startup indexing (`corpus.startup_index`) follows [[startup-prompt.md]] while `setup_status` is `cli_started`; `workspace_started` is committed only after the dictionary, index, maps, extraction coverage, and verification gates pass. **Never** dispatch `spinosa-overseer` during startup indexing.
- Cleanup proposals never mutate without an explicit approval transition; the approved proposal is applied exactly.

## Working as one bounded step

When invoked as a bounded workflow worker, use this contract:

Inputs: supplied node scope, coverage contract, input artifact paths, and exact
output artifact path.

Allowed: read supplied inputs, use permitted tools, and write the declared
artifact.

Return: artifact path, completion status, and any explicit coverage gap.

The coordinator/runtime owns routing, dispatch, artifact naming, gates,
verification, retries, and evaluation. A host may dispatch workers using its
own mechanism, but workers do not perform orchestration.

For `coverage: exhaustive`, do not early-stop: account for every corpus partition and denominator unit.
Pass prior artifact paths, not content, between steps. Do not invent facts, evidence, or constraints.
**Model:** use the host default / `preferred_llm_cli` from `system/configuration.md`. Do not hard-code a model id.

### Run IDs and artifact paths

Every orchestrated run gets a runtime run ID used by its generated artifact paths. Read the exact paths from the node prompt and `run.json`. The verifier writes its declared verification artifact; it changes another artifact only if that path is explicitly declared writable.

Legacy `evidence_packet.md` paths may exist in old workspaces. Use only the path supplied by the current workflow.

### Agent working memory

The workflow maintains [[.spinosa/memory/orchestrator-notes.md]] as working memory: session summaries, project context changes, blockers, resume hints, observations.

**Rules:** no secrets, credentials, large blobs, raw source dumps, or raw tool logs in the notepad. No sub-agent writes to the notepad except through its own step artifact.

## Safety & Permissions

- **All output must be written files.** Every answer is a report in [[agent_reports/]]. Fast-path answers may be delivered inline without a written report — only if no source search or artifact chain was involved.
- Do not edit [[raw/]] file bodies. Editing the YAML header is permitted.
- Do not use external sources without explicit researcher authorization.
- Check outputs with `spinosa-verifier` before reporting complete.

## Bounded Worker Roles

| NativeAgent          | Role                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `spinosa-searcher`   | Searches assigned scope under the runtime coverage contract; writes evidence to its assigned path |
| `spinosa-mapper`     | Extracts assigned files or writes maps explicitly assigned to the node |
| `spinosa-serendippo` | Records evidence-backed cross-source connections or an explicit no-connection result |
| `spinosa-analyst`    | Analyzes supplied context and artifacts; separates findings, hypotheses, and retrieval questions |
| `spinosa-writer`     | Produces the user-facing report at its runtime-assigned path |
| `spinosa-verifier`   | Checks claims against supplied original sources and writes a verification result |
| `spinosa-evaluator`  | Audits the supplied workflow trace and records process findings |
| `spinosa-evolver`    | Applies only the change approved by the runtime evolution gate |
| `spinosa-janitor`    | Reports independent hygiene counts and proposes cleanup without moving files |
| `spinosa-overseer`   | Performs an evidence-bounded audit when the coverage-audit workflow schedules it |

Canonical bounded-worker definitions are in [[.agents/agents/]]; the Spinosa
runtime loads their native agent files from [[.spinosa/agents/]]. Portable skills
and shared references remain in [[.agents/skills/]] and [[.agents/references/]].

## Global Rules

- Never read, list, or index `.DS_Store` or `._*` files. Always skip them in glob, find, ls, and read operations.
- **Workspace boundary:** You are confined to the workspace root. You must never read, write, edit, or list files outside this directory. If a task requires external data, use the `web` tool instead — never access files outside the workspace.
  - **Exception (post-startup only):** when `spinosa-overseer` is explicitly dispatched for a coverage audit after `setup_status: workspace_started`, it may optionally read host session logs for forensics. This exception does **not** apply during `cli_started` / startup, and never authorizes other agents to leave the workspace.
- No fixed set of maps is required. Maps can be created and enriched as needed.
- Report blockers honestly. Never invent support.
- First step of a researcher task: elaborate the prompt, then use the `question` tool with 1–3 questions only for scope confirmation/correction, missing user-supplied data, or real ambiguity—never questions for their own sake. Do not route or dispatch before answers return when you asked — **except** during `cli_started` / [[startup-prompt.md]] (no questions during startup indexing), or an unambiguous `fast_path` request.
- Sub-agents never ask questions directly.
