// Built-in workflow: research.targeted_evidence
// goal → searcher → evidence gate → writer → verifier → evaluator(policy)
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

const RETRY = { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error", "verification_partial"] as const }

export const researchTargeted: WorkflowDefinition = {
  id: "research.targeted_evidence",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "research" && d.strategy === "targeted_evidence"
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "research.targeted_evidence",
      version: 1,
      nodes: [
        { kind: "system", id: "goal", operation: "artifacts.write_goal", dependsOn: [] },
        {
          kind: "agent", id: "search", agent: "spinosa-searcher", dependsOn: ["goal"],
          visibility: "internal", promptKey: "search.targeted",
          toolPolicy: AGENT_CONTRACTS["spinosa-searcher"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "evidence", pathTemplate: `agent_reports/evidence_packet_${runID}.md`, required: true, validator: "evidence_packet" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        { kind: "gate", id: "evidence-gate", gate: "evidence_sufficiency", dependsOn: ["search"] },
        {
          kind: "agent", id: "write", agent: "spinosa-writer", dependsOn: ["evidence-gate"],
          visibility: "user", promptKey: "writer.report",
          toolPolicy: AGENT_CONTRACTS["spinosa-writer"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "report", pathTemplate: `agent_reports/NN_${runID}.md`, required: true, validator: "report" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        {
          kind: "agent", id: "verify", agent: "spinosa-verifier", dependsOn: ["write"],
          visibility: "internal", promptKey: "verifier.check",
          toolPolicy: AGENT_CONTRACTS["spinosa-verifier"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "verification", pathTemplate: `agent_reports/verification_${runID}.md`, required: true, validator: "verification" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        {
          kind: "agent", id: "evaluate", agent: "spinosa-evaluator", dependsOn: ["verify"],
          visibility: "internal", promptKey: "evaluator.audit",
          toolPolicy: AGENT_CONTRACTS["spinosa-evaluator"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "evaluation", pathTemplate: `agent_reports/e_${runID}.md`, required: false, validator: "evaluation" }],
          retry: { maxAttempts: 1, retryOn: [] }, timeoutMs: 120_000,
        },
      ],
    }
  },
}
