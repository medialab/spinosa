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
  // 1. Explicit selected agent: the user chose the executor, no routing.
  if (input.explicitAgent) {
    return { mode: "fast", action: "answer", reason: `explicit agent ${input.explicitAgent} bypasses routing`, confidence: 1 }
  }
  // 2. Non-Spinosa workspace → direct execution.
  if (!input.workspace.isSpinosa) {
    return { mode: "fast", action: "answer", reason: "non-Spinosa workspace", confidence: 0.95 }
  }
  // 3. The /startup flow only: explicit startup command or the startup
  // prompt text itself. Everything else — including what to do while the
  // workspace is unindexed — is the router model's call.
  if ((input.command && STARTUP_COMMANDS.has(input.command)) || isStartupIndexingPrompt(input.text)) {
    return orchestrated("corpus", "startup_index", "startup command or prompt", {
      scope: "corpus_wide",
      coverage: "exhaustive",
      verification: "strict",
    })
  }
  // Anything else → Stage 2 router model call.
  return undefined
}

/** Stage-2 fallback classifier for bounded single ops vs targeted research. */
export function heuristicAmbiguousRoute(text: string): RouteDecision {
  const wantsVisual = /visualiz|chart|plot|graph/i.test(text)
  if (wantsVisual && text.split(/\s+/).length < 40 && !/corpus|archive|sources/i.test(text)) {
    return { mode: "fast", action: "visualize", reason: "bounded visualization", confidence: 0.7 }
  }
  const bounded = /^(explain|summarize this|retrieve|convert|plot these)/i.test(text.trim())
  if (bounded) {
    const action = /plot|chart|visualiz/i.test(text) ? "visualize" : /retriev|quote/i.test(text) ? "retrieve" : /convert|transform/i.test(text) ? "transform" : "answer"
    return { mode: "fast", action, reason: "one bounded target", confidence: 0.7 }
  }
  if (/\b(corpus|archive|sources?|evidence)\b/i.test(text)) {
    const contextual = /analy[sz]e|compare|synthesi|taxonomy|patterns/i.test(text)
    return orchestrated("research", contextual ? "contextual_synthesis" : "targeted_evidence", "source-grounded multi-stage", {
      coverage: "sufficient",
    })
  }
  return { mode: "fast", action: "answer", reason: "ordinary conversation", confidence: 0.6 }
}
