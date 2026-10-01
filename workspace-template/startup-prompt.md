# Index This Workspace

Run the `corpus.startup_index` workflow for this workspace. The executable
WorkflowEngine is authoritative; this file is the portable fallback for a
host that cannot run the workflow directly. Follow the same phase order and
completion gates. Do not invent a second manual chain.

## Startup boundary

Startup runs while `setup_status: cli_started` and ends by committing
`workspace_started`. Do not invoke `spinosa-overseer`, `agent-interception`,
or the question tool during startup. Use the host-default model and worker
dispatch mechanism; never hard-code a model id.

Workers receive one bounded node with its file scope, coverage contract, input
artifact paths, and exact output paths. Workers do not route, dispatch, mint
paths, choose the next phase, or reinterpret gates.

## Required workflow

1. **Validate** — read `system/configuration.md`; confirm `cli_started`,
   `active_corpus_path: raw/`, and the required workspace directories.
2. **Survey** — inventory every eligible file under `raw/`, excluding control
   files, system files, empty directories, `.DS_Store`, and `._*` files.
3. **Partition** — create explicit file partitions and record the total.
4. **Extract fan-out** — run bounded `spinosa-mapper` nodes in parallel. Each
   batch uses a descriptive id and calls `spinosa_map` with the complete assigned
   `files` list. Every file must end as `extracted` or `unreadable`.
5. **Merge** — merge extraction packets and dictionary terms; record all
   accounted files in `system/workspace_index.md`.
6. **Dictionary** — write the canonical dictionary from the merged packets.
7. **Enrich** — add permitted semantic YAML fields and update context.
8. **Map write** — write only the map path or paths assigned to the map-write
   node. Check the required map artifacts and source links against the runtime
   gate; do not invent additional output paths.
9. **Connection analysis** — run the connection node when scheduled. Its
   report is optional, but the workflow phase is not silently skipped.
10. **Verification** — run the required verifier against startup artifacts and
    record one of the valid statuses: `pass`, `pass_with_corrections`,
    `partial`, `fail`, or `blocked`.
11. **Evaluation** — run the evaluator node when scheduled. Its artifact may
    be optional, but the attempt and outcome must remain in the run trace.
12. **Commit** — the WorkflowEngine commits `workspace_started` only after the
    required dictionary, index, map, extraction-coverage, and verification
    gates pass.

## Completion gate

Do not report startup complete until all of the following hold:

- `system/configuration.md` records `workspace_started`.
- `system/dictionary.md` exists and reflects the merged extraction packets.
- `system/workspace_index.md` records the inventory and extraction coverage.
- required maps exist and link every accounted source file.
- every assigned file is terminal: `extracted` or `unreadable` with a blocker.
- the required verification gate has passed; otherwise the workflow blocks the
  commit and records the non-success status.
- the run trace records the evaluation step and final commit decision.

A failed or partial gate keeps the workspace at `cli_started` and records the
missing files, artifact, or blocker. Do not claim completion from chat text.

## Extraction and recovery rules

Use `agent_reports/extraction_{batch_id}.md` with descriptive batch ids; do
not create bare `batch_001` names. `write_extraction` must include the full
assigned `files` list and one packet per assigned path. Mark unreadable files
explicitly rather than dropping them.

An existing extraction may be skipped only when its recorded file set exactly
matches the assigned set, every row is terminal, its `files_expected` and
`files_accounted` metadata is consistent, and artifact validation passes.
An existing filename alone is never evidence that a batch is complete.

On restart, inspect the run state and extraction manifests, resume the first
incomplete node, and rewrite partial batches with the complete assignment. Do
not skip a partial or mismatched artifact.

## Source and write boundaries

- Do not edit raw file bodies; only permitted YAML enrichment is allowed.
- Keep `AGENTS.md` and other control files out of corpus evidence.
- Use dictionary terms and Obsidian wikilinks consistently.
- Preserve extraction intermediates and validation notes for inspection.
- Do not ask clarification questions during startup; record blockers instead.
