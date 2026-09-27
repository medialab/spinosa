# Workflow Audit Template

```markdown
---
type: workflow_audit
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: pass | pass_with_findings | blocked
run_id: YYYYMMDD-{short_hash}
strategy: [runtime-selected strategy]
workflow: [workflow id and version]
decision: no_edit | edit_recommended
goal_artifact: [runtime-supplied path, if present]
terminal_artifact: [runtime-supplied path]
---

# Workflow Audit: [short title]

## Run Summary
- Prompt: [one-sentence cleaned prompt]
- Strategy and workflow: [runtime-selected values]
- Run state: [terminal state from run.json]
- Node outcomes: [completed, retried, blocked, or skipped nodes]
- Verification outcome: [pass | pass_with_corrections | partial | fail | blocked]

## Findings
- What worked:
  - [concrete process success]
- What did not work:
  - [concrete process weakness]

## Signal Review
- Trigger types: [integrity_issue, sequence_issue, ...]
- Metrics used: [counts or run observations]
- Evidence: [short grounded rationale]

## Decision
- Verdict: `no_edit` | `edit_recommended`
- Why: [one short paragraph]

## Proposed Evolution
- Target files: [paths or `none`]
- Smallest safe change: [concise implementation target]
- Expected effect on future workflows: [concise]

## Validation Notes
- Required next validation: [static checks, targeted dry run, or `none`]
- Run impact: [record whether this changes the current run or future workflows]
```
