// Built-in workflow: research.corpus_census
// inventory → partition → parallel searchers → coverage gate → analyst →
// [visualizer] → writer → verifier → evaluator.
// For coverage exhaustive, searcher early-stop ("two sources enough") is
// disabled via the coverage contract in the step prompt (see router-service).
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

const RETRY = { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error", "verification_partial"] as const }

export const researchCensus: WorkflowDefinition = {
  id: "research.corpus_census",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "research" && d.strategy === "corpus_census"
  },
  build({ runID, decision }): WorkflowPlan {
    const wantsVisual = decision.outputs.includes("visualization")
    return {
      id: "research.corpus_census",
      version: 1,
      nodes: [
        { kind: "system", id: "goal", operation: "artifacts.write_goal", dependsOn: [] },
        { kind: "system", id: "inventory", operation: "corpus.inventory", dependsOn: ["goal"] },
        { kind: "system", id: "partition", operation: "corpus.partition", dependsOn: ["inventory"] },
        {
          kind: "fanout", id: "search-fanout", sourceStep: "partition", templateKey: "search.partition",
          dependsOn: ["partition"], maxConcurrency: 4,
        },
        { kind: "gate", id: "coverage-gate", gate: "coverage", dependsOn: ["search-fanout"] },
        {
          kind: "agent", id: "aggregate", agent: "spinosa-analyst", dependsOn: ["coverage-gate"],
          visibility: "internal", promptKey: "analyst.aggregate",
          toolPolicy: AGENT_CONTRACTS["spinosa-analyst"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "analysis", pathTemplate: `agent_reports/analysis_${runID}.md`, required: true, validator: "analysis" }],
          retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
        },
        // Conditional visualization: skipped at runtime when outputs lack visualization.
        ...(wantsVisual
          ? [{
              kind: "agent" as const, id: "visualize", agent: "spinosa-writer", dependsOn: ["aggregate"] as const,
              visibility: "internal" as const, promptKey: "visualizer.chart",
              toolPolicy: AGENT_CONTRACTS["spinosa-writer"]!.defaultToolPolicy,
              expectedArtifacts: [{ kind: "visualization" as const, pathTemplate: `agent_reports/visualization_${runID}.md`, required: true, validator: "visualization" }],
              retry: { maxAttempts: RETRY.maxAttempts, retryOn: [...RETRY.retryOn] }, timeoutMs: 120_000,
            }]
          : []),
        {
          kind: "agent", id: "write", agent: "spinosa-writer", dependsOn: wantsVisual ? ["visualize"] : ["aggregate"],
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
