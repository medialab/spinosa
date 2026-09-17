import path from "node:path"
import type { OrchestratedDecision, WorkflowPlan } from "@spinosa/runtime"
import { writeTextAtomic } from "../utils/fs"

// WP10: legacy Q goal writers removed. New runs use buildWorkflowGoalBody /
// writeWorkflowGoalArtifact below. Legacy goal *parsing* stays in parser.ts
// so old workspaces remain readable.

// --- WP3: V2 workflow goal artifact (human-readable mirror of run.json) ---
// run.json remains the control plane; this Markdown is inspectable research
// state. Covers Cleaned Prompt, Route Decision, Objective, Scope/Denominator,
// Success Criteria, Workflow Plan, Artifact Paths, Step Decisions, Blockers.

export function buildWorkflowGoalBody(input: {
  runID: string
  cleanedPrompt: string
  decision: OrchestratedDecision
  plan: WorkflowPlan
  goalPath: string
  now?: Date
}): string {
  const created = (input.now ?? new Date()).toISOString()
  const d = input.decision
  const rows = input.plan.nodes
    .map((n) => {
      const agent = n.kind === "agent" ? n.agent : "—"
      const out =
        n.kind === "agent"
          ? n.expectedArtifacts.map((a) => a.kind).join(", ")
          : n.kind === "system"
            ? n.operation
            : n.kind === "gate"
              ? `gate:${n.gate}`
              : n.kind === "approval"
                ? `approval:${n.approval}`
                : `fanout:${(n as { templateKey: string }).templateKey}`
      return `| ${n.id} | ${n.kind} | ${agent} | ${(n.dependsOn as readonly string[]).join(", ") || "—"} | ${out} |`
    })
    .join("\n")
  const artifactRows = input.plan.nodes
    .filter((n) => n.kind === "agent")
    .flatMap((n) =>
      (n as Extract<WorkflowPlan["nodes"][number], { kind: "agent" }>).expectedArtifacts.map(
        (a) => `| ${a.kind} | \`${a.pathTemplate}\` |`,
      ),
    )
    .join("\n")
  return `---
type: goal
run_id: ${input.runID}
workflow_id: ${input.plan.id}
workflow_version: ${input.plan.version}
operation: ${d.operation}
strategy: ${d.strategy}
scope: ${d.scope}
coverage: ${d.coverage}
verification: ${d.verification}
status: running
---

# Goal Artifact

## Cleaned Prompt

${input.cleanedPrompt.trim()}

## Route Decision

- mode: ${d.mode}
- operation: ${d.operation}
- strategy: ${d.strategy}
- scope: ${d.scope}
- coverage: ${d.coverage}
- verification: ${d.verification}
- reason: ${d.reason}
- confidence: ${d.confidence}

## Research Objective

Deliver a verified Spinosa report for this request when the workflow completes.

## Scope and Denominator

- scope: ${d.scope}
- coverage: ${d.coverage}
- outputs: ${d.outputs.join(", ")}

## Success Criteria

- Evidence and claims trace to approved source paths
- Terminal report exists under agent_reports/NN_*.md
- Verifier and evaluator gates recorded under Step Decisions

## Workflow Plan

| Step | Kind | Agent | Depends on | Expected output |
|------|------|-------|------------|-----------------|
${rows}

## Artifact Paths

| Role | Path |
|------|------|
| Goal | \`${input.goalPath}\` |
${artifactRows}

## Step Decisions

- ${created.slice(0, 16).replace("T", " ")} — Workflow planned → ${input.plan.id} v${input.plan.version}

## Blockers and Limitations

- None yet.
`
}

export async function writeWorkflowGoalArtifact(
  workspacePath: string,
  input: { runID: string; cleanedPrompt: string; decision: OrchestratedDecision; plan: WorkflowPlan },
): Promise<{ goalPath: string }> {
  const relative = path.join("agent_reports", `g_${input.runID}.md`)
  const body = buildWorkflowGoalBody({ ...input, goalPath: relative })
  writeTextAtomic(path.join(workspacePath, relative), body)
  return { goalPath: relative }
}

/** Bounded step contract injected per workflow step (replaces Q-route preamble). */
export function workflowStepPreamble(input: {
  workspacePath: string
  workflowID: string
  stepID: string
  agent: string
  runID: string
  goalPath?: string
  coverage?: string
  scope?: string
}): string {
  const lines = [
    "You are executing one bounded Spinosa workflow step.",
    "Do not call the Task tool.",
    "Do not dispatch another agent.",
    "Do not choose the next workflow phase.",
    "Use only the supplied scope and artifact paths.",
    "Write the exact requested artifact.",
    "Stop after returning its path and completion signals.",
    `Workspace: ${input.workspacePath}`,
    `Workflow: ${input.workflowID} step ${input.stepID} (run ${input.runID})`,
    `Assigned agent: ${input.agent}`,
  ]
  if (input.goalPath) lines.push(`Goal artifact: ${input.goalPath}`)
  if (input.scope) lines.push(`Scope: ${input.scope}`)
  if (input.coverage) {
    lines.push(`Coverage contract: ${input.coverage}`)
    if (input.coverage === "exhaustive") {
      lines.push("Coverage is exhaustive: do NOT early-stop after two sources. Account for every corpus partition and denominator unit.")
    }
  }
  lines.push("Do not paste long reports into chat — write the artifact file and point to it.")
  return lines.join("\n")
}
