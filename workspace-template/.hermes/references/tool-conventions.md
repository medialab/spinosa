# Tool Conventions — General-Harness Operation

The workflow engine is paused. Orchestration is model-led through the general
harness (Task dispatches + subagents). These deterministic tools replace the
engine's control plane. Use them — never reimplement their logic by hand.

## The loop

1. **Route** every non-trivial request with `spinosa_route` first.
   General answers need nothing else. Orchestrated work continues below.
   Provisional fallbacks invite your judgment: override when the request
   clearly needs more or less than the fallback claims.
2. **Frame** orchestrated work with `spinosa_frame` before dispatching
   research subagents. The goal artifact it writes scopes the whole run.
   Never frame direct answers.
3. **Mint** every artifact path with `spinosa_mint_paths` before writing.
   Never invent filenames — parallel runs collide otherwise.
4. **Work** through subagents, passing artifact paths (not content) between steps.
5. **Gate** source-grounded claims with `spinosa_gate` before delivery.
6. **Verify** every artifact with `spinosa_verify` before passing or
   delivering it. Mechanical checks pass here; quote-level truth against
   original sources remains agent judgment.
7. **Audit**: end orchestrated work by dispatching `spinosa-evaluator`.
   The evaluator audits the trace and decides whether framework evolution
   is justified. No gate blocks on it — the audit is convention, not control.

## Role mapping

| Agent | Must call |
|-------|-----------|
| searcher, mapper | `spinosa_mint_paths` before writing packets/batches |
| analyst, writer | `spinosa_mint_paths`, then `spinosa_verify` on the artifact |
| verifier | `spinosa_verify` on every target; quote-truth stays judgment |
| overseer, janitor | `spinosa_gate` for coverage claims, `spinosa_verify` on findings |
| evaluator | Runs last via dispatcher; writes `e_{runID}.md` |

## Rules

- Tools decide structure; you decide meaning. Never eyeball coverage,
  filenames, or verification status when a tool computes them.
- A failed gate or verification is a finding, not a suggestion:
  gather the missing coverage or fix the artifact, then re-run the tool.
- Record outcomes back into the goal artifact as the run proceeds.
