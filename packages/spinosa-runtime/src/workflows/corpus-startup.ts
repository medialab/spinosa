// Built-in workflow: corpus.startup_index
// Deterministic executable form of startup-prompt.md phases.
// setup_status=workspace_started commits only in the final system node,
// after dictionary + maps + index + verifier + report gates pass.
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

export const corpusStartup: WorkflowDefinition = {
  id: "corpus.startup_index",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "corpus" && d.strategy === "startup_index"
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "corpus.startup_index",
      version: 1,
      nodes: [
        { kind: "system", id: "validate", operation: "workspace.validate", dependsOn: [] },
        { kind: "system", id: "survey", operation: "corpus.inventory", dependsOn: ["validate"] },
        { kind: "system", id: "partition", operation: "corpus.partition", dependsOn: ["survey"] },
        {
          kind: "fanout", id: "extract-fanout", sourceStep: "partition", templateKey: "mapper.extract",
          dependsOn: ["partition"], maxConcurrency: 4,
        },
        { kind: "system", id: "merge", operation: "artifacts.merge_extractions", dependsOn: ["extract-fanout"] },
        { kind: "system", id: "dictionary", operation: "corpus.build_dictionary", dependsOn: ["merge"] },
        { kind: "system", id: "enrich", operation: "corpus.enrich_headers", dependsOn: ["dictionary"] },
        {
          kind: "agent", id: "map-write", agent: "spinosa-mapper", dependsOn: ["enrich"],
          visibility: "internal", promptKey: "mapper.map_write",
          toolPolicy: AGENT_CONTRACTS["spinosa-mapper"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "map", pathTemplate: `maps/corpus_overview.md`, required: true, validator: "maps" }],
          // Mapper batches are minutes-scale: exempt from the 120s steady-state timeout.
          retry: { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error"] },
        },
        {
          kind: "agent", id: "connect", agent: "spinosa-serendippo", dependsOn: ["map-write"],
          visibility: "internal", promptKey: "serendippo.connections",
          toolPolicy: AGENT_CONTRACTS["spinosa-serendippo"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "serendipity", pathTemplate: `agent_reports/serendipity_${runID}.md`, required: false, validator: "serendipity" }],
          retry: { maxAttempts: 1, retryOn: ["temporary_error"] }, timeoutMs: 300_000,
        },
        {
          kind: "agent", id: "verify", agent: "spinosa-verifier", dependsOn: ["connect"],
          visibility: "internal", promptKey: "verifier.workspace",
          toolPolicy: AGENT_CONTRACTS["spinosa-verifier"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "verification", pathTemplate: `agent_reports/verification_${runID}.md`, required: true, validator: "verification" }],
          retry: { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error", "verification_partial"] }, timeoutMs: 180_000,
        },
        {
          kind: "agent", id: "evaluate", agent: "spinosa-evaluator", dependsOn: ["verify"],
          visibility: "internal", promptKey: "evaluator.audit",
          toolPolicy: AGENT_CONTRACTS["spinosa-evaluator"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "evaluation", pathTemplate: `agent_reports/e_${runID}.md`, required: false, validator: "evaluation" }],
          retry: { maxAttempts: 1, retryOn: [] }, timeoutMs: 120_000,
        },
        { kind: "system", id: "commit-started", operation: "workspace.commit_started", dependsOn: ["evaluate"] },
      ],
    }
  },
}
