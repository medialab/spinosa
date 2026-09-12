// Built-in workflows: maintenance (proposal vs apply strictly separated).
// cleanup_proposal ends in waiting_for_approval; cleanup_apply requires an
// approved proposal and verifies afterwards. Never combine without approval.
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

export const maintenanceProposal: WorkflowDefinition = {
  id: "maintenance.cleanup_proposal",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "maintenance" && (d.strategy === "cleanup_proposal" || d.strategy === "integrity_check")
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "maintenance.cleanup_proposal",
      version: 1,
      nodes: [
        {
          kind: "agent", id: "audit", agent: "spinosa-janitor", dependsOn: [],
          visibility: "internal", promptKey: "janitor.audit",
          toolPolicy: AGENT_CONTRACTS["spinosa-janitor"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "coverage", pathTemplate: `agent_reports/cleanup_proposal_${runID}.md`, required: true, validator: "cleanup" }],
          retry: { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error"] }, timeoutMs: 120_000,
        },
        { kind: "approval", id: "approve", approval: "cleanup_proposal", dependsOn: ["audit"] },
      ],
    }
  },
}

export const maintenanceApply: WorkflowDefinition = {
  id: "maintenance.cleanup_apply",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "maintenance" && (d.strategy === "cleanup_apply" || d.strategy === "repair")
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "maintenance.cleanup_apply",
      version: 1,
      nodes: [
        { kind: "system", id: "load", operation: "maintenance.load_proposal", dependsOn: [] },
        { kind: "system", id: "apply", operation: "maintenance.apply_proposal", dependsOn: ["load"] },
        { kind: "system", id: "verify-workspace", operation: "workspace.validate", dependsOn: ["apply"] },
        {
          kind: "agent", id: "evaluate", agent: "spinosa-evaluator", dependsOn: ["verify-workspace"],
          visibility: "internal", promptKey: "evaluator.audit",
          toolPolicy: AGENT_CONTRACTS["spinosa-evaluator"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "evaluation", pathTemplate: `agent_reports/e_${runID}.md`, required: false, validator: "evaluation" }],
          retry: { maxAttempts: 1, retryOn: [] }, timeoutMs: 120_000,
        },
      ],
    }
  },
}
