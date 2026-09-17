// Built-in workflow: corpus.add_sources (incremental add, not full reindex).
// Mirrors generateAddPrompt() phases as executable nodes.
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"
import { AGENT_CONTRACTS } from "../agent-contracts"

export const corpusAdd: WorkflowDefinition = {
  id: "corpus.add_sources",
  version: 1,
  matches(d: OrchestratedDecision) {
    return d.operation === "corpus" && (d.strategy === "add_sources" || d.strategy === "reindex" || d.strategy === "remap" || d.strategy === "enrich_metadata")
  },
  build({ runID }): WorkflowPlan {
    return {
      id: "corpus.add_sources",
      version: 1,
      nodes: [
        { kind: "system", id: "detect", operation: "corpus.detect_unmapped", dependsOn: [] },
        { kind: "system", id: "partition", operation: "corpus.partition", dependsOn: ["detect"] },
        {
          kind: "fanout", id: "extract-fanout", sourceStep: "partition", templateKey: "mapper.extract",
          dependsOn: ["partition"], maxConcurrency: 4,
        },
        { kind: "system", id: "merge", operation: "artifacts.merge_extractions", dependsOn: ["extract-fanout"] },
        { kind: "system", id: "dictionary", operation: "corpus.update_dictionary", dependsOn: ["merge"] },
        { kind: "system", id: "maps", operation: "corpus.update_maps", dependsOn: ["dictionary"] },
        { kind: "system", id: "index", operation: "corpus.update_index", dependsOn: ["maps"] },
        {
          kind: "agent", id: "verify", agent: "spinosa-verifier", dependsOn: ["index"],
          visibility: "internal", promptKey: "verifier.workspace",
          toolPolicy: AGENT_CONTRACTS["spinosa-verifier"]!.defaultToolPolicy,
          expectedArtifacts: [{ kind: "verification", pathTemplate: `agent_reports/verification_${runID}.md`, required: true, validator: "verification" }],
          retry: { maxAttempts: 2, retryOn: ["missing_artifact", "invalid_artifact", "temporary_error", "verification_partial"] }, timeoutMs: 180_000,
        },
        { kind: "system", id: "cleanup", operation: "artifacts.cleanup_process_files", dependsOn: ["verify"] },
      ],
    }
  },
}
