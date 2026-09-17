// Built-in workflow: corpus maintenance (reindex/remap/enrich fallthrough).
// Resolved when corpusAdd does not claim the decision; kept separate so the
// registry documents an explicit maintenance grammar.
import type { OrchestratedDecision } from "../routing"
import type { WorkflowDefinition, WorkflowPlan } from "../workflow"

export const corpusMaintenance: WorkflowDefinition = {
  id: "corpus.maintenance",
  version: 1,
  matches(_d: OrchestratedDecision) {
    return false // Reserved grammar; corpusAdd owns reindex/remap/enrich today.
  },
  build(): WorkflowPlan {
    return { id: "corpus.maintenance", version: 1, nodes: [] }
  },
}
