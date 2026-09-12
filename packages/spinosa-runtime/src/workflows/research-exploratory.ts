// Built-in workflow: research.exploratory_discovery
// orientation → serendippo roaming → analyst interpretation →
// writer → verifier → evaluator.
// Searcher (targeted retrieval) and Serendippo (weak-signal roaming) stay
// separate by design.
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

const RETRY = { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error", "verification_partial"] as const }

export const researchExploratory: WorkflowDefinition = {
  id: "research.exploratory_discovery",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "research" && d.strategy === "exploratory_discovery"
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "research.exploratory_discovery",
      version: 1,
      nodes: [
        { kind: "system", id: "goal", operation: "artifacts.write_goal", dependsOn: [] },
        {
          kind: "agent", id: "orient", agent: "spinosa-searcher", dependsOn: ["goal"],
          visibility: "internal", promptKey: "search.orientation",
          toolPolicy: AGENT_CONTRACTS["spinosa-searcher"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "evidence", pathTemplate: `agent_reports/evidence_packet_${runID}.md`, required: true, validator: "evidence_packet" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        {
          kind: "agent", id: "roam", agent: "spinosa-serendippo", dependsOn: ["orient"],
          visibility: "internal", promptKey: "serendippo.roam",
          toolPolicy: AGENT_CONTRACTS["spinosa-serendippo"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "serendipity", pathTemplate: `agent_reports/serendipity_${runID}.md`, required: true, validator: "serendipity" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        {
          kind: "agent", id: "interpret", agent: "spinosa-analyst", dependsOn: ["roam"],
          visibility: "internal", promptKey: "analyst.interpret",
          toolPolicy: AGENT_CONTRACTS["spinosa-analyst"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "analysis", pathTemplate: `agent_reports/analysis_${runID}.md`, required: true, validator: "analysis" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        {
          kind: "agent", id: "write", agent: "spinosa-writer", dependsOn: ["interpret"],
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
