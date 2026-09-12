// Built-in workflow: research.hypothesis_test
// criteria → 3-way evidence fanout (supporting/contradicting/edge) →
// adjudication → writer → verifier → evaluator.
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

const RETRY = { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error", "verification_partial"] as const }

export const researchHypothesis: WorkflowDefinition = {
  id: "research.hypothesis_test",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "research" && d.strategy === "hypothesis_test"
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "research.hypothesis_test",
      version: 1,
      nodes: [
        { kind: "system", id: "goal", operation: "artifacts.write_goal", dependsOn: [] },
        {
          kind: "agent", id: "criteria", agent: "spinosa-analyst", dependsOn: ["goal"],
          visibility: "internal", promptKey: "analyst.test_criteria",
          toolPolicy: AGENT_CONTRACTS["spinosa-analyst"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "analysis", pathTemplate: `agent_reports/analysis_criteria_${runID}.md`, required: true, validator: "analysis" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        {
          kind: "fanout", id: "evidence-fanout", sourceStep: "criteria", templateKey: "search.hypothesis_arm",
          dependsOn: ["criteria"], maxConcurrency: 3,
        },
        {
          kind: "agent", id: "adjudicate", agent: "spinosa-analyst", dependsOn: ["evidence-fanout"],
          visibility: "internal", promptKey: "analyst.adjudicate",
          toolPolicy: AGENT_CONTRACTS["spinosa-analyst"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "analysis", pathTemplate: `agent_reports/analysis_${runID}.md`, required: true, validator: "analysis" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        {
          kind: "agent", id: "write", agent: "spinosa-writer", dependsOn: ["adjudicate"],
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
