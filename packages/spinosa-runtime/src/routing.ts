// WP1: Structured route decisions — replaces Q1..Q5 identifiers in new runs.
// Legacy Q routes remain in routes.ts behind legacyRouteDecision() until WP10.
// This module is pure: no filesystem, TUI, or kernel imports.

export type ExecutionMode = "fast" | "orchestrated"

export type FastAction = "answer" | "retrieve" | "transform" | "visualize"

export type OperationFamily = "research" | "corpus" | "maintenance" | "meta"

export type ResearchStrategy =
  | "targeted_evidence"
  | "contextual_synthesis"
  | "corpus_census"
  | "comparative_synthesis"
  | "hypothesis_test"
  | "exploratory_discovery"

export type CorpusStrategy =
  | "startup_index"
  | "add_sources"
  | "reindex"
  | "remap"
  | "enrich_metadata"

export type MaintenanceStrategy =
  | "integrity_check"
  | "cleanup_proposal"
  | "cleanup_apply"
  | "repair"

export type MetaStrategy = "coverage_audit" | "route_audit" | "framework_evolution"

export type Scope = "local" | "subset" | "corpus_wide"

export type Coverage = "opportunistic" | "sufficient" | "representative" | "exhaustive"

export type OutputKind = "chat" | "report" | "table" | "visualization" | "map"

export type MutationPolicy = "none" | "propose" | "allowed" | "requires_approval"

export type VerificationPolicy = "none" | "normal" | "strict"

export type EvaluationPolicy = "always" | "on_failure" | "sampled" | "never"

export type FastDecision = {
  mode: "fast"
  action: FastAction
  reason: string
  confidence: number
}

export type OrchestratedDecision = {
  mode: "orchestrated"
  operation: OperationFamily
  strategy: ResearchStrategy | CorpusStrategy | MaintenanceStrategy | MetaStrategy
  scope: Scope
  coverage: Coverage
  outputs: readonly OutputKind[]
  mutation: MutationPolicy
  verification: VerificationPolicy
  evaluation: EvaluationPolicy
  reason: string
  confidence: number
}

export type RouteDecision = FastDecision | OrchestratedDecision

export function isOrchestratedDecision(decision: RouteDecision): decision is OrchestratedDecision {
  return decision.mode === "orchestrated"
}

export function isFastDecision(decision: RouteDecision): decision is FastDecision {
  return decision.mode === "fast"
}

/** Deterministic fallback when the router agent is unavailable or low-confidence. */
export function fallbackDecision(input: { hasResearchIntent: boolean; reason: string }): RouteDecision {
  if (!input.hasResearchIntent) {
    return { mode: "fast", action: "answer", reason: input.reason, confidence: 0.5 }
  }
  return {
    mode: "orchestrated",
    operation: "research",
    strategy: "targeted_evidence",
    scope: "subset",
    coverage: "sufficient",
    outputs: ["report"],
    mutation: "none",
    verification: "normal",
    evaluation: "always",
    reason: input.reason,
    confidence: 0.5,
  }
}
