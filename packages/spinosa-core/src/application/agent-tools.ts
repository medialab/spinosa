// Agent tools core — deterministic Spinosa aids exposed as callable tools
// for the general harness. No control plane here (no runs, retries, gates
// as state): the model orchestrates, these functions make its moves exact.
// Every function returns a result union (never throws on domain input) so
// kernel tool Defs can render output text directly.

import {
  deterministicRoute,
  heuristicAmbiguousRoute,
  WorkflowRegistry,
  workflowLabel,
  type OrchestratedDecision,
  type RouteDecision,
  type RouteInput,
} from "@spinosa/runtime"
import { generateSessionId } from "../session-id"
import { isSpinosaWorkspace } from "../workspace/meta"
import { writeWorkflowGoalArtifact } from "../artifacts/goal"
import { evidenceGate, validateArtifact, verificationOutcome } from "../artifacts/validate"
import { parseVerificationStatus } from "../artifacts/contracts"

export type { OrchestratedDecision, RouteDecision } from "@spinosa/runtime"
export { ROUTE_STRATEGIES, formatRouteTitle, workflowLabel } from "@spinosa/runtime"

// --- spinosa_route ---

export type SpinosaRouteResult = {
  decision: RouteDecision
  /** Rules decided ("rules") or abstained and a heuristic stands in ("heuristic"). */
  via: "rules" | "heuristic"
  /**
   * True when deterministic rules abstained: the heuristic fallback stands
   * in, and the caller should override it with model judgment when the
   * request clearly needs more (or less) than the fallback claims.
   */
  provisional: boolean
}

export function spinosaRoute(input: {
  text: string
  isSpinosa: boolean
  setupStatus: RouteInput["workspace"]["setupStatus"]
  fileCount?: number
  hasSelectedRange?: boolean
  fileNames?: readonly string[]
  mimeTypes?: readonly string[]
  explicitAgent?: string
  command?: string
}): SpinosaRouteResult {
  const routeInput: RouteInput = {
    text: input.text,
    workspace: { isSpinosa: input.isSpinosa, setupStatus: input.setupStatus },
    references: {
      fileCount: input.fileCount ?? 0,
      hasSelectedRange: input.hasSelectedRange ?? false,
      fileNames: input.fileNames ?? [],
      mimeTypes: input.mimeTypes ?? [],
    },
    ...(input.explicitAgent ? { explicitAgent: input.explicitAgent } : {}),
    ...(input.command ? { command: input.command } : {}),
  }
  const hard = deterministicRoute(routeInput)
  if (hard) return { decision: hard, via: "rules", provisional: false }
  return { decision: heuristicAmbiguousRoute(routeInput.text), via: "heuristic", provisional: true }
}

// --- spinosa_frame ---

export type SpinosaFrameResult =
  | {
      ok: true
      runID: string
      workflowID: string
      planLabel: string
      goalPath: string
      decision: OrchestratedDecision
    }
  | { ok: false; reason: string }

export async function spinosaFrame(input: {
  workspacePath: string
  cleanedPrompt: string
  decision: OrchestratedDecision
}): Promise<SpinosaFrameResult> {
  if (!isSpinosaWorkspace(input.workspacePath)) {
    return { ok: false, reason: "not a Spinosa workspace: framing applies to workspace runs only" }
  }
  if (!input.cleanedPrompt.trim()) {
    return { ok: false, reason: "empty prompt: nothing to frame" }
  }
  const runID = generateSessionId()
  let definition
  try {
    definition = new WorkflowRegistry().resolve(input.decision)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  const plan = definition.build({ runID, decision: input.decision })
  const { goalPath } = await writeWorkflowGoalArtifact(input.workspacePath, {
    runID,
    cleanedPrompt: input.cleanedPrompt,
    decision: input.decision,
    plan,
  })
  return { ok: true, runID, workflowID: plan.id, planLabel: workflowLabel(plan.id), goalPath, decision: input.decision }
}

// --- spinosa_mint_paths ---

export type MintableArtifactKind =
  | "goal"
  | "evidence"
  | "evidence_appendix"
  | "extraction"
  | "analysis"
  | "serendipity"
  | "report"
  | "verification"
  | "evaluation"
  | "coverage"
  | "map"
  | "cleanup"

export function spinosaMintPaths(input: {
  runID: string
  kinds: readonly MintableArtifactKind[]
  /** Required for evidence fan-out and extraction batches (descriptive slug). */
  branch?: string
  /** Required for numbered writer reports (next free NN). */
  reportNumber?: string
  /** Required for numbered writer reports (kebab-case topic slug). */
  reportSlug?: string
}): { ok: true; paths: Partial<Record<MintableArtifactKind, string>> } | { ok: false; reason: string } {
  if (!/^\d{8}-[0-9a-f]+$/.test(input.runID)) {
    return { ok: false, reason: `runID must look like YYYYMMDD-short_hash (got ${input.runID})` }
  }
  const paths: Partial<Record<MintableArtifactKind, string>> = {}
  for (const kind of input.kinds) {
    switch (kind) {
      case "goal":
        paths.goal = `agent_reports/g_${input.runID}.md`
        break
      case "evidence":
        paths.evidence = input.branch
          ? `agent_reports/evidence_packet_${input.runID}_${input.branch}.md`
          : `agent_reports/evidence_packet_${input.runID}.md`
        break
      case "evidence_appendix":
        paths.evidence_appendix = `agent_reports/evidence_appendix_${input.runID}.md`
        break
      case "extraction":
        if (!input.branch) return { ok: false, reason: "extraction needs a descriptive branch/batch slug" }
        paths.extraction = `agent_reports/extraction_${input.branch}.md`
        break
      case "analysis":
        paths.analysis = `agent_reports/analysis_${input.runID}.md`
        break
      case "serendipity":
        paths.serendipity = `agent_reports/serendipity_${input.runID}.md`
        break
      case "report":
        if (!input.reportNumber || !input.reportSlug) {
          return { ok: false, reason: "report needs reportNumber (NN) and reportSlug (kebab-case topic)" }
        }
        paths.report = `agent_reports/${input.reportNumber}_${input.reportSlug}.md`
        break
      case "verification":
        paths.verification = `agent_reports/verification_${input.runID}.md`
        break
      case "evaluation":
        paths.evaluation = `agent_reports/e_${input.runID}.md`
        break
      case "coverage":
        paths.coverage = `agent_reports/c_${input.runID}.md`
        break
      case "map":
        paths.map = input.branch ? `maps/${input.branch}.md` : `maps/corpus_overview.md`
        break
      case "cleanup":
        paths.cleanup = `agent_reports/cleanup_${input.runID}.md`
        break
    }
  }
  return { ok: true, paths }
}

// --- spinosa_gate ---

export type SpinosaGateResult = { pass: boolean; reason: string }

export function spinosaGate(input: {
  coverage: "opportunistic" | "sufficient" | "representative" | "exhaustive"
  sourceCount: number
  strataCovered?: number
  strataTotal?: number
  partitionsAccounted?: number
  partitionsTotal?: number
}): SpinosaGateResult {
  return evidenceGate({
    coverage: input.coverage,
    sourceCount: Math.max(0, Math.floor(input.sourceCount)),
    strataCovered: input.strataCovered ?? 0,
    strataTotal: input.strataTotal ?? 0,
    partitionsAccounted: input.partitionsAccounted ?? 0,
    partitionsTotal: input.partitionsTotal ?? 0,
  })
}

// --- spinosa_verify ---

export type SpinosaVerifyResult =
  | {
      ok: true
      status: string
      action: "complete" | "retry" | "block"
    }
  | { ok: false; error: string; retryable: boolean }

const VERIFY_VALIDATORS = [
  "goal",
  "evidence_packet",
  "analysis",
  "serendipity",
  "report",
  "verification",
  "evaluation",
  "extraction",
  "map",
  "coverage",
  "cleanup",
] as const

export type VerifyValidator = (typeof VERIFY_VALIDATORS)[number]

export async function spinosaVerify(input: {
  workspacePath: string
  relativePath: string
  validator: VerifyValidator
  runID?: string
}): Promise<SpinosaVerifyResult> {
  if (!isSpinosaWorkspace(input.workspacePath)) {
    return { ok: false, error: "not a Spinosa workspace", retryable: false }
  }
  const checked = await validateArtifact({
    workspacePath: input.workspacePath,
    relativePath: input.relativePath,
    validator: input.validator,
    ...(input.runID ? { runID: input.runID } : {}),
  })
  if (!checked.ok) return { ok: false, error: checked.error, retryable: checked.retryable }
  if (input.validator === "verification") {
    const { default: path } = await import("node:path")
    const { readFile } = await import("node:fs/promises")
    const text = await readFile(path.join(input.workspacePath, input.relativePath), "utf-8").catch(() => "")
    const status = parseVerificationStatus(text) ?? "fail"
    return { ok: true, status, action: verificationOutcome(status) }
  }
  return { ok: true, status: "pass", action: "complete" }
}
