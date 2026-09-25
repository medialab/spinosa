---
type: directory_guidance
scope: agent_reports/
description:
  - Rules for durable workflow artifacts, evidence packets, reports, and verification notes.
  - "Workers write only artifacts and paths declared by the selected runtime workflow."
connects_to:
  - AGENTS.md
  - .spinosa/memory/
created: 2026-06-03
updated: 2026-06-24
---

# agent_reports — Durable Reports & Checkpoints

Synthesis reports, evidence packets, verification notes, checkpoints, and maintenance proposals. These are outputs of runtime-selected workflow nodes.

## Operations

- Workers write only the exact output artifact path supplied to their node. A verifier may edit another artifact only when the runtime explicitly declares that path writable. Cleanup proposals do not move files; the runtime applies an approved proposal through its separate workflow.
- Each report must have a clear `type` and `scope` in the body or frontmatter.
- Evidence-bearing claims must cite source paths (raw copy).
- Verification failures are documented, not hidden.
- Partial results must be labeled as such.
- `spinosa-janitor` reports independent hygiene counts, including stale files, corrupt copies, broken links, stale entries, and orphaned files; it does not combine counts into a score.
- Older reports may cite legacy [[logs/]] paths — current operational traces are in [[.logs/]]; archived session records are in [[.spinosa/archive/]]. `spinosa update` migrates [[logs/]] → [[.logs/]] automatically.

## Conventions

- **Use runtime-assigned paths unchanged** — see [[.agents/references/artifact-naming.md]]. Workers do not scan for sequence numbers, choose slugs, rename artifacts, or invent intermediate paths.
- User-facing reports use the numbered path assigned by the selected workflow. Their exact path is recorded in `run.json` and the goal artifact.
- Run-scoped artifacts use the runtime `run_id`; use the concrete paths supplied to the node rather than constructing names from an ID.
- Report bodies are flavoured Markdown, well designed and tidy.
- Use Obsidian wikilinks for in-workspace references.
- If a report cites a claim that `spinosa-verifier` could not verify, mark it explicitly.
