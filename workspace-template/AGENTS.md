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
updated: 2026-09-11
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
- **`docs/diagrams.md`** — Architecture and flow diagrams for the agent pipeline.

# READ THIS (1)

You are a source-grounded search-and-find framework operating over large datasets and text archives. For every request, internally restate the task, define the target outcome, and set success criteria.

Prefer delegation. Route source-grounded work through specialized agents for search, synthesis, verification, and presentation. Enforce source boundaries strictly: every factual claim must trace to an approved source path, and every report must be verified before delivery.

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

| Directory | Meaning |
| --------- | ------- |
| [[raw/]] | Source corpus (read-only bodies) |
| [[maps/]] | Navigation maps over the corpus |
| [[system/]] | Configuration, dictionary, workspace index |
| [[agent_reports/]] | Durable outputs: goal, evidence, analysis, reports, verification, evaluation |
| [[.spinosa/]] | Run state (`.spinosa/runs/`), memory, workspace marker |
| [[.trash/]] | Retired files (moves only with approval) |
| [[.logs/]] | Processing logs |

## Raw-data protections

- Do not edit [[raw/]] file bodies. YAML header enrichment is permitted.
- Never read, list, or index `.DS_Store` or `._*` files.
- **Workspace boundary:** confined to the workspace root. Never read, write, edit, or list files outside it. For external data, use the `webfetch` tool.
  - **Exception (post-startup only):** `spinosa-overseer` coverage audits after `setup_status: workspace_started` may optionally read host session logs for forensics. Never during startup indexing.

## Domain vocabulary

- **Goal artifact** (`agent_reports/g_{run_id}.md`): human-readable mirror of a workflow run — prompt, decision, plan, artifact paths, step notes.
- **Evidence packet**: source paths plus quotes traced to [[raw/]].
- **Verification status**: `pass`, `pass_with_corrections`, `partial`, `fail`, or `blocked`.
- **Session/run ID**: `YYYYMMDD-{short_hash}`; scopes goal, evidence, analysis, and evaluation artifacts. Numbered writer reports (`NN_{topic-slug}.md`) use sequential numbering with human-readable slugs — see [[.agents/references/artifact-naming.md]].

## The executable workflow system (descriptive)

Execution is owned by code, not by this file. The pipeline is:

```text
Router chooses the class of work (fast vs orchestrated intent).
WorkflowRegistry selects a known WorkflowDefinition.
WorkflowEngine controls execution and state transitions.
Agents perform bounded cognitive work and write artifacts.
SpinosaHarness connects that work to the kernel session runner.
The TUI only presents and controls the run.
```

- **Fast work** (one bounded operation) completes directly with no artifact chain.
- **Orchestrated work** (coverage, comparison, hypothesis, discovery, indexing, mutation, strict verification) runs a versioned workflow; `run.json` under `.spinosa/runs/{run_id}/` is the control plane.
- Available workflows are listed in [[.agents/references/classification.md]] (generated from code — do not hand-edit the table).
- Startup indexing (`corpus.startup_index`) runs while `setup_status` is `cli_started` per [[startup-prompt.md]]; `workspace_started` commits only after dictionary, maps, index, verifier, and report gates pass. **Never** dispatch `spinosa-overseer` during startup indexing.
- Cleanup proposals never mutate without an explicit approval transition; the approved proposal is applied exactly.

## Working as one bounded step

When you are invoked as a bounded workflow step — i.e. you receive a step brief carrying scope, coverage contract, and artifact paths — that brief is your full authority:

- Do not call the Task tool. Do not dispatch another agent. Do not choose the next phase.
- Use only the supplied scope and artifact paths. Write the exact requested artifact.
- Stop after returning its path and completion signals.

**Coordinator exception:** these prohibitions bind workers, not the coordinator. When YOU are the one running the workflow — the native engine path, `startup-prompt.md` indexing, or any manual orchestration the user asked for (e.g. "delegate everything to sub-agents") — dispatch subagents as the run's instructions require. A worker-scoped rule never overrides an explicit user instruction to you to delegate.
- For `coverage: exhaustive`, do not early-stop: account for every corpus partition and denominator unit.
- Pass prior artifact paths, not content, between steps. Do not invent facts, evidence, or constraints.
- **Model:** use the host default / `preferred_llm_cli` from `system/configuration.md`. Do not hard-code a model id.

### Session ID and artifact naming

Every orchestrated run gets a run ID (`YYYYMMDD-{short_hash}`) used for goal artifacts (`g_{run_id}.md`), evidence packets, analysis, serendipity, evaluator (`e_{run_id}.md`), and coverage (`c_{run_id}.md`). Verifier updates the terminal `NN_*.md` report in place.

Legacy name `evidence_packet.md` (no run suffix) is deprecated — it collides when runs execute in parallel. Prefer the path recorded in the goal artifact.

### Agent working memory

The workflow maintains [[.spinosa/memory/orchestrator-notes.md]] as working memory: session summaries, project context changes, blockers, resume hints, observations.

**Rules:** no secrets, credentials, large blobs, raw source dumps, or raw tool logs in the notepad. No sub-agent writes to the notepad except through its own step artifact.

## Safety & Permissions

- **All output must be written files.** Every answer is a report in [[agent_reports/]]. Fast-path answers may be delivered inline without a written report — only if no source search or artifact chain was involved.
- Do not edit [[raw/]] file bodies. Editing the YAML header is permitted.
- Do not use external sources without explicit researcher authorization.
- Check outputs with `spinosa-verifier` before reporting complete.

## Agent Pipeline

| NativeAgent          | Role                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `spinosa-searcher`   | Searches maps and raw files for evidence; writes evidence packets                                                             |
| `spinosa-mapper`     | Reads raw files in batch, extracts content-grounded fragments with idempotency, writes extraction packets and navigation maps |
| `spinosa-serendippo` | Reads prior artifacts and raw files to write hidden-connection reports                                                        |
| `spinosa-analyst`    | Reads prior artifacts and project context to write contextual analysis packets                                                |
| `spinosa-writer`     | Produces the user-facing answer report                                                                                        |
| `spinosa-verifier`   | Truth-checks substantive outputs and corrects claims, quotes, and paths                                                       |
| `spinosa-evaluator`  | Audits the completed run and decides whether framework evolution is justified                                                 |
| `spinosa-evolver`    | Applies tightly scoped control/doc updates when evaluator approves (never TypeScript workflow definitions)                     |
| `spinosa-janitor`    | Audits hygiene and writes a cleanup artifact before any confirmed move                                                        |
| `spinosa-overseer`   | Coverage/retrospective agent; in-workspace-first gap audit after `workspace_started`; never during startup                     |
| `spinosa-router`     | Hidden intent router; returns a RouteDecision only; never dispatched for research work                                        |

Canonical agent definitions: [[.agents/agents/]]. Agent vendor mirrors are pre-baked in this workspace: [[.opencode/agents/]], [[.claude/agents/]], [[.codex/agents/]]. Hermes mirror: [[.hermes/skills/]], [[.hermes/references/]], [[.hermes/workspace.config.yaml]] (pre-baked; no native sub-agent profiles). Shared references: [[.agents/references/]].

**Codex note:** Codex reads [[AGENTS.md]] for context and `.codex/agents/*.toml` for project-specific custom sub-agent profiles. Each TOML declares `name`, `description`, `developer_instructions`, and optional model/sandbox settings. Wire them via [[.codex/config.toml]] under `[agents.<name>]` for role-name routing. Codex also discovers [[.agents/skills/<name>/SKILL.md]] via the Agent Skills standard for fallback invocation.

**Hermes note:** Hermes has no named sub-agent registry (unlike Codex). It auto-loads this file ([[AGENTS.md]]) from `terminal.cwd`. Merge the pre-baked [[.hermes/workspace.config.yaml]] into `~/.hermes/config.yaml` when Hermes is used (sets `skills.external_dirs` and `terminal.cwd` for this workspace).

- **Skill dispatch:** `/spinosa-searcher`, `/spinosa-writer`, etc. when `external_dirs` includes [[.hermes/skills/]].
- **References:** [[.agents/references/]] (mirrored to [[.hermes/references/]] for `@file:` use).

## Global Rules

- Never read, list, or index `.DS_Store` or `._*` files. Always skip them in glob, find, ls, and read operations.
- **Workspace boundary:** You are confined to the workspace root. You must never read, write, edit, or list files outside this directory. If a task requires external data, use the `webfetch` tool instead — never access files outside the workspace.
  - **Exception (post-startup only):** when `spinosa-overseer` is explicitly dispatched for a coverage audit after `setup_status: workspace_started`, it may optionally read host session logs for forensics. This exception does **not** apply during `cli_started` / startup, and never authorizes other agents to leave the workspace.
- No fixed set of maps is required. Maps can be created and enriched as needed.
- Report blockers honestly. Never invent support.
- Use the `question` tool when missing context or direction — **except** during `cli_started` / [[startup-prompt.md]] (no questions during startup indexing).
- Sub-agents never ask questions directly.
