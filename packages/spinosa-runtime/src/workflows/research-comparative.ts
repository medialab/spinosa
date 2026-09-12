// Built-in workflow: research.comparative_synthesis
// design → cohort fanout (A/B) → balance gate → analyst → [visualizer] →
// writer → verifier → evaluator.
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

const RETRY = { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error", "verification_partial"] as const }

export const researchComparative: WorkflowDefinition = {
  id: "research.comparative_synthesis",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "research" && d.strategy === "comparative_synthesis"
  },
  build({ runID, decision }): WorkflowPlan {
    const wantsVisual = decision.outputs.includes("visualization")
    return {
      id: "research.comparative_synthesis",
      version: 1,
      nodes: [
        { kind: "system", id: "goal", operation: "artifacts.write_goal", dependsOn: [] },
        { kind: "system", id: "cohort-design", operation: "research.design_cohorts", dependsOn: ["goal"] },
        {
          kind: "fanout", id: "cohort-fanout", sourceStep: "cohort-design", templateKey: "search.cohort",
          dependsOn: ["cohort-design"], maxConcurrency: 2,
        },
        { kind: "gate", id: "balance-gate", gate: "cohort_balance", dependsOn: ["cohort-fanout"] },
        {
          kind: "agent", id: "compare", agent: "spinosa-analyst", dependsOn: ["balance-gate"],
          visibility: "internal", promptKey: "analyst.compare",
          toolPolicy: AGENT_CONTRACTS["spinosa-analyst"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "analysis", pathTemplate: `agent_reports/analysis_${runID}.md`, required: true, validator: "analysis" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        ...(wantsVisual
          ? [{
              kind: "agent" as const, id: "visualize", agent: "spinosa-writer", dependsOn: ["compare"] as const,
              visibility: "internal" as const, promptKey: "visualizer.chart",
              toolPolicy: AGENT_CONTRACTS["spinosa-writer"]!.defaultToolPolicy,
              expectedArtifacts: [{ kind: "visualization" as const, pathTemplate: `agent_reports/visualization_${runID}.md`, required: true, validator: "visualization" }],
              retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
            }]
          : []),
        {
          kind: "agent", id: "write", agent: "spinosa-writer", dependsOn: wantsVisual ? ["visualize"] : ["compare"],
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
