// Model-first routing: apart from structural bypasses (explicit agent,
// non-Spinosa workspace, the /startup flow), every prompt is classified by
// the constrained router model (Stage 2). No regex interprets request
// semantics here — the router prompt carries the strategy catalog and
// workspace state instead. Deterministic heuristics survive only as a
// last-resort fallback when no harness/model is available.

import { isStartupIndexingPrompt } from "./startup"
import type { OrchestratedDecision, RouteDecision } from "./routing"

export type RouteInput = {
  text: string
  workspace: {
    isSpinosa: boolean
    setupStatus: "not_started" | "importing" | "cli_started" | "workspace_started" | "unknown"
  }
  references: {
    fileCount: number
    hasSelectedRange: boolean
    fileNames: readonly string[]
    mimeTypes: readonly string[]
  }
  explicitAgent?: string
  command?: string
}

const STARTUP_COMMANDS = new Set(["startup", "index", "init-index"])

function orchestrated(
  operation: OrchestratedDecision["operation"],
  strategy: OrchestratedDecision["strategy"],
  reason: string,
  overrides: Partial<OrchestratedDecision> = {},
): OrchestratedDecision {
  return {
    mode: "orchestrated",
    operation,
    strategy,
    scope: "subset",
    coverage: "sufficient",
    outputs: ["report"],
    mutation: "none",
    verification: "normal",
    evaluation: "always",
    reason,
    confidence: 0.85,
    ...overrides,
  }
}

/**
 * Structural bypasses only — nothing here interprets request semantics.
 * Returns a decision, or undefined when the request needs the router model.
 */
export function deterministicRoute(input: RouteInput): RouteDecision | undefined {
  // 1. Non-Spinosa workspace → direct execution.
  if (!input.workspace.isSpinosa) {
    return { mode: "general" }
  }
  // 2. Startup indexing wins over a pinned agent. The TUI forces Orchestrator
  // (`build`) for this flow; that pin must not collapse the run to chat.
  if ((input.command && STARTUP_COMMANDS.has(input.command)) || isStartupIndexingPrompt(input.text)) {
    return orchestrated("corpus", "startup_index", "startup command or prompt", {
      scope: "corpus_wide",
      coverage: "exhaustive",
      verification: "strict",
    })
  }
  // 3. Explicit selected agent: the user chose the executor, no routing.
  if (input.explicitAgent) {
    return { mode: "general" }
  }
  // Anything else → Stage 2 router model call.
  return undefined
}

/** Stage-2 fallback classifier for bounded single ops vs targeted research. */
export function heuristicAmbiguousRoute(text: string): RouteDecision {
  if (/\b(new files?|added (?:new )?files?|incremental add)\b/i.test(text) && /\b(raw\/|corpus|sources?)\b/i.test(text)) {
    return orchestrated("corpus", "add_sources", "new files to ingest")
  }
  if (/\b(apply(?: the)? cleanup|move stale|\.trash)\b/i.test(text)) {
    return orchestrated("maintenance", "cleanup_apply", "apply approved cleanup")
  }
  if (/\b(clean\s*up|cleanup|hygiene|stale files)\b/i.test(text)) {
    return orchestrated("maintenance", "cleanup_proposal", "hygiene")
  }
  if (/\bcoverage\b/i.test(text) && /\b(gaps?|maps?|missing)\b/i.test(text)) {
    return orchestrated("meta", "coverage_audit", "coverage audit")
  }
  if (/\b(corpus|archive|sources?|evidence)\b/i.test(text)) {
    const contextual = /analy[sz]e|compare|synthesi|taxonomy|patterns/i.test(text)
    return orchestrated("research", contextual ? "contextual_synthesis" : "targeted_evidence", "source-grounded multi-stage", {
      coverage: "sufficient",
    })
  }
  return { mode: "general" }
}
