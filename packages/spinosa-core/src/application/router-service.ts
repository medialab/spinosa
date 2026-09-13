// WP5: Router service — Stage 1 deterministic hard routing + Stage 2
// constrained router agent (hidden, zero tools, returns RouteDecision JSON).
// The router returns intent dimensions; WorkflowRegistry resolves to a known
// workflow. Never returns arbitrary workflow IDs or agent names.

import type { SpinosaHarness } from "@spinosa/harness"
import type { FastDecision, OrchestratedDecision, RouteDecision } from "@spinosa/runtime"
import { deterministicRoute, heuristicAmbiguousRoute, type RouteInput } from "@spinosa/runtime"

const LOW_CONFIDENCE = 0.55

/**
 * Upper bound for the Stage-2 router model call. The submit path shows an
 * optimistic "evaluating" row while routing, so an unbounded router turn
 * (queued behind a busy session, retry storm, slow provider) would leave
 * that row spinning with zero feedback. Past the deadline the heuristic
 * decides and the orphan is cancelled. A verdict is a tiny JSON call;
 * 15s is generous.
 */
export const ROUTER_MODEL_TIMEOUT_MS = 15_000

/** Thrown when the caller aborts routing (Esc during evaluating). Not a failure. */
export class RouterAbortedError extends Error {
  constructor() {
    super("router call aborted")
    this.name = "RouterAbortedError"
  }
}

/**
 * The router model sometimes thinks aloud before/after the JSON. Extract
 * the outermost {...} block so a preamble never kills the parse — the
 * verdict still counts as model-routed.
 */
export function extractRouterJson(text: string): string {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return text
  return text.slice(start, end + 1)
}

function coerceDecision(value: unknown): RouteDecision | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (v.mode === "generic") return { mode: "generic" }
  if (v.mode === "fast" && typeof v.action === "string") {
    if (!["answer", "retrieve", "transform", "visualize"].includes(v.action)) return undefined
    return {
      mode: "fast",
      action: v.action as FastDecision["action"],
      reason: typeof v.reason === "string" ? v.reason : "router agent",
      confidence: typeof v.confidence === "number" ? v.confidence : 0.7,
    }
  }
  if (v.mode === "orchestrated" && typeof v.operation === "string" && typeof v.strategy === "string") {
    if (!["research", "corpus", "maintenance", "meta"].includes(v.operation)) return undefined
    const d = v as Record<string, unknown>
    const pick = (key: string, allowed: readonly string[], fallback: string) =>
      typeof d[key] === "string" && (allowed as readonly string[]).includes(d[key] as string)
        ? (d[key] as string)
        : fallback
    return {
      mode: "orchestrated",
      operation: v.operation as OrchestratedDecision["operation"],
      strategy: v.strategy as OrchestratedDecision["strategy"],
      scope: pick("scope", ["local", "subset", "corpus_wide"], "subset") as OrchestratedDecision["scope"],
      coverage: pick("coverage", ["opportunistic", "sufficient", "representative", "exhaustive"], "sufficient") as OrchestratedDecision["coverage"],
      outputs: Array.isArray(d.outputs) ? (d.outputs as OrchestratedDecision["outputs"]) : ["report"],
      mutation: pick("mutation", ["none", "propose", "allowed", "requires_approval"], "none") as OrchestratedDecision["mutation"],
      verification: pick("verification", ["none", "normal", "strict"], "normal") as OrchestratedDecision["verification"],
      evaluation: pick("evaluation", ["always", "on_failure", "sampled", "never"], "always") as OrchestratedDecision["evaluation"],
      reason: typeof d.reason === "string" ? d.reason : "router agent",
      confidence: typeof d.confidence === "number" ? d.confidence : 0.7,
    }
  }
  return undefined
}

export function buildRouterPrompt(input: RouteInput): string {
  return [
    "You are the Spinosa router. Return ONLY a JSON RouteDecision.",
    "Definitions:",
    "- fast: one bounded operation needing no corpus work and no artifacts: greetings, thanks, explain a term, summarize ONE supplied document, retrieve one quote, convert a table, plot a few values.",
    "- generic: none of the above fits, or you are unsure — the default agent just answers normally with no special handling. Prefer this over guessing fast or orchestrated.",
    "- orchestrated: anything needing corpus-wide coverage, partitions, cohort balance, completeness claims, comparison, hypothesis testing, hidden-pattern discovery, persistent artifacts, multi-step cognition, mutation/approval, strict verification, or indexing/remapping.",
    `Workspace state: isSpinosa=${input.workspace.isSpinosa} setupStatus=${input.workspace.setupStatus}.`,
    "setupStatus cli_started means the corpus is NOT indexed yet. Then: trivial chat (greetings, thanks) → fast; anything touching corpus content, coverage, maps, dictionary, or indexing → corpus.startup_index; never choose research, maintenance, or meta strategies for an unindexed workspace.",
    "Available strategies:",
    "- research.targeted_evidence: single-topic lookup, quotes and paths are enough.",
    "- research.contextual_synthesis: synthesis, comparison, taxonomy, patterns across sources.",
    "- research.corpus_census: completeness claims (who mentions X, every file, full coverage).",
    "- research.comparative_synthesis: explicit group/cohort comparison.",
    "- research.hypothesis_test: an explicit hypothesis to test for/against.",
    "- research.exploratory_discovery: hidden, implicit, or unexpected connections.",
    "- corpus.startup_index: index the whole workspace (unindexed state only).",
    "- corpus.add_sources: new files were added; integrate the additions only.",
    "- corpus.reindex / corpus.remap / corpus.enrich_metadata: targeted corpus rework.",
    "- maintenance.integrity_check / cleanup_proposal / cleanup_apply / repair: hygiene and archival. cleanup_apply and repair mutate: set mutation accordingly.",
    "- meta.coverage_audit / route_audit: coverage and gap analysis (only after workspace_started).",
    "- meta.framework_evolution: change the framework itself.",
    "Coverage ladder: opportunistic (≥1 source) < sufficient (bounded claim) < representative (every stratum/cohort) < exhaustive (every partition; only for explicit full-corpus demands).",
    `User request: ${input.text}`,
    `Attachments: ${input.references.fileCount} files (${input.references.fileNames.slice(0, 5).join(", ")})`,
    'Schema: {"mode":"fast","action":"answer|retrieve|transform|visualize","reason":string,"confidence":number} OR {"mode":"orchestrated","operation":"research|corpus|maintenance|meta","strategy":string,"scope":"local|subset|corpus_wide","coverage":"opportunistic|sufficient|representative|exhaustive","outputs":["chat|report|table|visualization|map"],"mutation":"none|propose|allowed|requires_approval","verification":"none|normal|strict","evaluation":"always|on_failure|sampled|never","reason":string,"confidence":number} OR {"mode":"generic"}',
    "Do not select agents or workflow IDs. Return intent dimensions only.",
  ].join("\n")
}

export type RoutedRequest = {
  decision: RouteDecision
  /**
   * How the decision was reached — declared in the conversation badge so
   * routing is visible, not silent. "model" means the constrained router
   * call ran (even when its output fell back); "rules" means pure code.
   */
  via: "rules" | "model"
}

export async function routeRequest(input: {
  routeInput: RouteInput
  harness?: SpinosaHarness
  sessionID?: string
  /** The conversation's selected model — the router call reuses it (CALL 1). */
  model?: { providerID: string; modelID: string }
  /** AbortSignal for Esc-during-evaluating. Aborts the router turn. */
  signal?: AbortSignal
  /** Override for tests. */
  timeoutMs?: number
}): Promise<RoutedRequest> {
  // Stage 1: deterministic rules (startup before coverage heuristics).
  const hard = deterministicRoute(input.routeInput)
  if (hard) return { decision: hard, via: "rules" }
  // Stage 2: constrained router agent only when needed. Separate internal
  // call, same selected model; synthetic + silent so the raw JSON never hits
  // the transcript — the verdict is declared via `via` instead.
  if (input.harness && input.sessionID) {
    if (input.signal?.aborted) throw new RouterAbortedError()
    const harness = input.harness
    const sessionID = input.sessionID
    let consulted = false
    try {
      const verdict = harness.executeAgent({
        sessionID,
        agent: "spinosa-router",
        prompt: buildRouterPrompt(input.routeInput),
        system: "You are executing one bounded Spinosa workflow step. Return only valid JSON. Do not call tools or dispatch agents.",
        synthetic: true,
        silent: true,
        ...(input.model ? { model: input.model } : {}),
      })
      const timeoutMs = input.timeoutMs ?? ROUTER_MODEL_TIMEOUT_MS
      const signal = input.signal
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      let verdictText: string
      try {
        const result = await Promise.race([
          verdict.then((v) => ({ status: "verdict" as const, value: v })),
          new Promise<{ status: "timeout" }>((_, reject) => {
            timer = setTimeout(() => reject(new Error("router model timeout")), timeoutMs)
          }),
          ...(signal
            ? [
                new Promise<{ status: "aborted" }>((_, reject) => {
                  onAbort = () => reject(new RouterAbortedError())
                  signal.addEventListener("abort", onAbort, { once: true })
                }),
              ]
            : []),
        ])
        if (result.status !== "verdict") {
          // Unreachable: timeout/abort legs reject, they never resolve.
          throw new Error("router model timeout")
        }
        verdictText = result.value.text
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        if (onAbort && signal) signal.removeEventListener("abort", onAbort)
      }
      consulted = true
      const parsed = coerceDecision(JSON.parse(extractRouterJson(verdictText)))
      if (parsed) {
        // Low-confidence verdicts (including an explicit generic verdict)
        // degrade to a plain answer: never force a fast action or a
        // research workflow on a shrug.
        if (parsed.mode === "generic" || parsed.confidence < LOW_CONFIDENCE) {
          return { decision: { mode: "generic" }, via: "model" }
        }
        return { decision: parsed, via: "model" }
      }
      // Model was consulted but returned garbage: no verdict — the
      // default agent just answers normally (generic, never forced).
      return { decision: { mode: "generic" }, via: "model" }
    } catch (err) {
      if (err instanceof RouterAbortedError) {
        // Esc during evaluating: kill the orphan turn so it stops burning
        // tokens, then propagate — the caller treats this as cancelled,
        // never as a routing verdict.
        await harness.cancelExecution({ sessionID }).catch(() => {})
        throw err
      }
      // Timeout (or transport failure): cancel the orphan turn so it stops
      // burning tokens after we have already fallen back. Fallback is
      // generic — a plain answer, never a forced workflow.
      await harness.cancelExecution({ sessionID }).catch(() => {})
      // No usable model output: generic fallback, marked by whether a call ran.
      return {
        decision: { mode: "generic" },
        via: consulted ? "model" : "rules",
      }
    }
  }
  // Deterministic fallback for ambiguous input.
  return { decision: heuristicAmbiguousRoute(input.routeInput.text), via: "rules" }
}
