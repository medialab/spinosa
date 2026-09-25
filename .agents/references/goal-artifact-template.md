# Runtime Goal Artifact

The runtime writes this human-readable mirror before executing a workflow. The
control plane is `.spinosa/runs/{run_id}/run.json`; never edit this mirror to
change routing, dependencies, gates, retries, paths, or terminal state.

The runtime-generated artifact contains these sections:

```markdown
---
type: goal
run_id: [runtime run ID]
workflow_id: [selected workflow ID]
workflow_version: [selected workflow version]
operation: [runtime operation]
strategy: [runtime-selected strategy]
scope: [runtime scope]
coverage: [opportunistic | sufficient | representative | exhaustive]
verification: [runtime verification policy]
status: running
---

# Goal Artifact

## Cleaned Prompt
[Runtime-normalized request]

## Route Decision
[Mode, operation, strategy, scope, coverage, verification, reason, confidence]

## Research Objective
[Workflow-level objective]

## Scope and Denominator
[Runtime scope, coverage contract, and expected outputs]

## Success Criteria
[Workflow completion criteria]

## Workflow Plan
| Step | Kind | Agent | Depends on | Expected output |
|------|------|-------|------------|-----------------|
[Selected workflow node rows]

## Artifact Paths
| Role | Path |
|------|------|
[Exact paths from the selected workflow]

## Step Decisions
[Runtime-recorded workflow events]

## Blockers and Limitations
[Runtime-recorded blockers and limitations]
```

Workers receive their individual node scope, inputs, and exact output path
separately. They do not infer work from this table or select the next node.
