// Built-in workflows: meta (coverage audit gains verifier; framework
// evolution gates evolver behind policy and forbids TS self-modification).
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

export const metaCoverage: WorkflowDefinition = {
  id: "meta.coverage_audit",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "meta" && (d.strategy === "coverage_audit" || d.strategy === "route_audit")
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "meta.coverage_audit",
      version: 1,
      nodes: [
        {
          kind: "agent", id: "overseer", agent: "spinosa-overseer", dependsOn: [],
          visibility: "internal", promptKey: "overseer.audit",
          toolPolicy: AGENT_CONTRACTS["spinosa-overseer"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "coverage", pathTemplate: `agent_reports/c_${runID}.md`, required: true, validator: "coverage" }],
          retry: { maxAttempts: 1, retryOn: ["temporary_error"] }, timeoutMs: 120_000,
        },
        {
          kind: "agent", id: "verify", agent: "spinosa-verifier", dependsOn: ["overseer"],
          visibility: "internal", promptKey: "verifier.check",
          toolPolicy: AGENT_CONTRACTS["spinosa-verifier"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "verification", pathTemplate: `agent_reports/verification_${runID}.md`, required: true, validator: "verification" }],
          retry: { maxAttempts: 1, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error"] }, timeoutMs: 120_000,
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

export const metaEvolution: WorkflowDefinition = {
  id: "meta.framework_evolution",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "meta" && d.strategy === "framework_evolution"
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "meta.framework_evolution",
      version: 1,
      nodes: [
        {
          kind: "agent", id: "recommend", agent: "spinosa-evaluator", dependsOn: [],
          visibility: "internal", promptKey: "evaluator.recommend",
          toolPolicy: AGENT_CONTRACTS["spinosa-evaluator"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "evaluation", pathTemplate: `agent_reports/e_${runID}.md`, required: true, validator: "evaluation" }],
          retry: { maxAttempts: 1, retryOn: [] }, timeoutMs: 120_000,
        },
        { kind: "gate", id: "policy-gate", gate: "evolution_policy", dependsOn: ["recommend"] },
        {
          kind: "agent", id: "evolve", agent: "spinosa-evolver", dependsOn: ["policy-gate"],
          visibility: "internal", promptKey: "evolver.apply",
          toolPolicy: AGENT_CONTRACTS["spinosa-evolver"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "evaluation", pathTemplate: `agent_reports/evolution_${runID}.md`, required: true, validator: "evaluation" }],
          retry: { maxAttempts: 1, retryOn: [] }, timeoutMs: 120_000,
        },
        { kind: "system", id: "validate", operation: "evolution.validate", dependsOn: ["evolve"] },
      ],
    }
  },
}
