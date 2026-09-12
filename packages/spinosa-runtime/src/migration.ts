// WP1: Legacy run migration — decode run.json (V1 Q-routes or V2) into V2.
// Keep old JSONL events readable; add new event types in model.ts.

import type { ResearchRun } from "./model"
import type { WorkflowRun } from "./model"
import type { OrchestratedDecision } from "./routing"
import type { RouteClass } from "./routes"
import { agentsForRoute } from "./routes"

export function legacyRouteDecision(route: RouteClass): OrchestratedDecision {
  const base = {
    mode: "orchestrated" as const,
    scope: "subset" as const,
    coverage: "sufficient" as const,
    outputs: ["report"] as const,
    mutation: "none" as const,
    verification: "normal" as const,
    evaluation: "always" as const,
    reason: `legacy ${route} compatibility`,
    confidence: 0.6,
  }
  switch (route) {
    case "Q1":
      return { ...base, operation: "research", strategy: "targeted_evidence" }
    case "Q2":
      return { ...base, operation: "research", strategy: "contextual_synthesis" }
    case "Q3":
      return { ...base, operation: "research", strategy: "exploratory_discovery" }
    case "Q4":
      return {
        ...base,
        operation: "maintenance",
        strategy: "cleanup_proposal",
        mutation: "propose",
        outputs: ["report"],
      }
    case "Q5":
      return { ...base, operation: "meta", strategy: "coverage_audit", evaluation: "always" }
    default:
      return { ...base, operation: "research", strategy: "targeted_evidence" }
  }
}

function legacyWorkflowID(route: RouteClass): { id: string; version: number } {
  switch (route) {
    case "Q1":
      return { id: "research.targeted_evidence", version: 1 }
    case "Q2":
      return { id: "research.contextual_synthesis", version: 1 }
    case "Q3":
      return { id: "research.exploratory_discovery", version: 1 }
    case "Q4":
      return { id: "maintenance.cleanup_proposal", version: 1 }
    case "Q5":
      return { id: "meta.coverage_audit", version: 1 }
    default:
      return { id: "research.targeted_evidence", version: 1 }
  }
}

function legacyAgentsToSteps(route: RouteClass, phaseIndex: number): WorkflowRun["steps"] {
  // Q5 compat gains verifier: overseer done, evaluator pending → verifier pending.
  const extraVerifier = route === "Q5" ? ["spinosa-verifier"] : []
  const agents = [...agentsForRoute(route)]
  if (route === "Q5" && agents.includes("spinosa-overseer") && !agents.includes("spinosa-verifier")) {
    const idx = agents.indexOf("spinosa-overseer")
    agents.splice(idx + 1, 0, ...extraVerifier)
  }
  const steps: WorkflowRun["steps"] = {}
  agents.forEach((agent, i) => {
    const id = agent.replace("spinosa-", "")
    if (i < phaseIndex) steps[id] = { id, status: "succeeded", attempt: 1 }
    else if (i === phaseIndex) steps[id] = { id, status: "pending", attempt: 0 }
    else steps[id] = { id, status: "pending", attempt: 0 }
  })
  return steps
}

export function isWorkflowRunV2(value: unknown): value is WorkflowRun {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return v.schemaVersion === 2 && typeof v.id === "string" && typeof v.workflowID === "string"
}

export function isLegacyResearchRun(value: unknown): value is ResearchRun {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return typeof v.id === "string" && typeof v.route === "string" && typeof v.phaseIndex === "number" && v.schemaVersion !== 2
}

export function migrateLegacyRun(legacy: ResearchRun): WorkflowRun {
  const { id, version } = legacyWorkflowID(legacy.route)
  const terminal =
    legacy.status === "completed"
      ? "completed"
      : legacy.status === "blocked"
        ? "blocked"
        : legacy.status === "failed"
          ? "failed"
          : legacy.status === "cancelled"
            ? "cancelled"
            : "running"
  return {
    schemaVersion: 2,
    id: legacy.id,
    workspacePath: legacy.workspacePath,
    parentSessionID: legacy.id,
    prompt: legacy.prompt,
    decision: legacyRouteDecision(legacy.route === "fast_path" ? "Q1" : legacy.route),
    workflowID: id,
    workflowVersion: version,
    status: terminal as WorkflowRun["status"],
    steps: legacyAgentsToSteps(legacy.route === "fast_path" ? "Q1" : legacy.route, legacy.phaseIndex),
    artifacts: [],
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    blocker: legacy.blocker,
    error: legacy.error,
  }
}

export function decodeWorkflowRun(value: unknown): WorkflowRun {
  if (isWorkflowRunV2(value)) return value
  if (isLegacyResearchRun(value)) return migrateLegacyRun(value)
  throw new Error("Invalid Spinosa workflow run")
}
