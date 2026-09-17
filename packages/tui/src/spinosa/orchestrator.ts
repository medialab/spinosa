// WP7: TUI facade over WorkflowRunService. The TUI knows only:
// direct vs orchestrated, active run ID, status to show, how to cancel.
// It never knows agent order, retry counts, or verifier gates.
import { WorkflowRunService } from "@spinosa/core/application/workflow-run-service"
import { SpinosaKernelHarness } from "@spinosa/harness"
import {
  cancelWorkflowRun,
  FileWorkflowRunRepository,
  WorkflowRegistry,
  withRunLock,
  type OrchestratedDecision,
  type RouteDecision,
} from "@spinosa/runtime"
import { createImportJob, cancelSpinosaJob, type ImportJobHandle } from "./job-events"

type ActiveWorkflowRun = {
  runID: string
  workflowID: string
  workspacePath: string
  job: ImportJobHandle
}

const activeWorkflowRuns = new Map<string, ActiveWorkflowRun>()
// Legacy alias kept for the cutover (WP10 removes).
export const activeResearchRuns = activeWorkflowRuns

/** True while a workflow engine run owns the session (dispatcher treats it as busy). */
export function hasActiveWorkflowRun(sessionID: string): boolean {
  return activeWorkflowRuns.has(sessionID)
}

export type PreparedSubmit = {
  text: string
  kind: "direct" | "workflow"
  decision: RouteDecision
  sessionId?: string
  goalPath?: string
  workspacePath?: string
  workflowID?: string
  framed: boolean
  /** Routing provenance: a model call ran ("model") or pure code ("rules"). */
  routedBy?: "rules" | "model"
}

/**
 * WP7: research prep is now the default Spinosa workspace path.
 * SPINOSA_SKIP_RESEARCH_PREP is removed (no permanent old/new toggle).
 * Bypass remains for: explicit forceAgent, shell mode, slash commands
 * (enforced at the prompt call site), non-Spinosa workspaces (service).
 */
export function shouldPrepareSpinosaSubmit(input: {
  sessionDirectory?: string
  forceAgent?: string
}): boolean {
  return Boolean(input.sessionDirectory && !input.forceAgent)
}

export async function prepareSpinosaSubmit(
  workspacePath: string,
  promptText: string,
  opts?: {
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    references?: { fileCount: number; fileNames: readonly string[]; mimeTypes: readonly string[]; hasSelectedRange: boolean }
    explicitAgent?: string
    command?: string
    /**
     * Kernel client for the Stage-2 router call. When present, ambiguous
     * requests are classified by the conversation's selected model (same
     * model, separate silent internal call); when absent, prepare falls back
     * to deterministic heuristics only.
     */
    client?: unknown
    /** AbortSignal for Esc-during-evaluating (aborts the router turn). */
    signal?: AbortSignal
    /** Override for the Stage-2 router call (tests). */
    routerTimeoutMs?: number
  },
): Promise<PreparedSubmit> {
  const harness =
    opts?.client !== undefined
      ? new SpinosaKernelHarness(opts.client as ConstructorParameters<typeof SpinosaKernelHarness>[0])
      : undefined
  const prepared = await new WorkflowRunService(undefined, undefined, harness).prepare({
    workspacePath,
    parentSessionID: opts?.parentSessionID ?? `tui-${Date.now()}`,
    prompt: promptText,
    model: opts?.model,
    references: opts?.references,
    explicitAgent: opts?.explicitAgent,
    command: opts?.command,
    ...(opts?.signal ? { signal: opts.signal } : {}),
    ...(opts?.routerTimeoutMs !== undefined ? { routerTimeoutMs: opts.routerTimeoutMs } : {}),
  })
  if (prepared.kind === "direct") {
    return { text: prepared.text, kind: "direct", decision: prepared.decision, framed: false, routedBy: prepared.routedBy }
  }
  return {
    text: prepared.text,
    kind: "workflow",
    decision: prepared.decision,
    sessionId: prepared.runID,
    goalPath: prepared.goalPath,
    workspacePath: prepared.workspacePath,
    workflowID: prepared.workflowID,
    framed: true,
    routedBy: prepared.routedBy,
  }
}

export async function executeSpinosaSubmit(input: {
  client: unknown
  sessionID: string
  prepared: PreparedSubmit
  model: { providerID: string; modelID: string }
  /** Host GlobalBus publish so session chrome can observe research jobs. */
  publish?: Parameters<typeof createImportJob>[0]["publish"]
  /** In-process TUI emitter for immediate strip updates. */
  localEmit?: Parameters<typeof createImportJob>[0]["localEmit"]
  /** Live per-step progress mirror (conversation badge reads the same feed). */
  onProgress?: (progress: {
    runID: string
    done: number
    total: number
    stepID: string
    status: "done" | "failed" | "error" | "processing"
  }) => void
}): Promise<"completed" | "blocked" | "failed" | "waiting_for_approval" | "cancelled"> {
  const harness = new SpinosaKernelHarness(input.client as ConstructorParameters<typeof SpinosaKernelHarness>[0])
  if (input.prepared.kind !== "workflow" || !input.prepared.sessionId || !input.prepared.workspacePath) {
    return "completed"
  }
  const runID = input.prepared.sessionId
  const workspacePath = input.prepared.workspacePath
  const workflowID = input.prepared.workflowID ?? "workflow"
  if (activeWorkflowRuns.has(input.sessionID)) {
    await cancelSpinosaSubmit({ client: input.client, sessionID: input.sessionID })
  }
  const decision = input.prepared.decision
  const title = decision.mode === "orchestrated" ? `Research · ${workflowID}` : `Research · direct`
  const job = createImportJob({
    kind: "research",
    title,
    directory: workspacePath,
    publish: input.publish,
    localEmit: input.localEmit,
  })
  const active = { runID, workflowID, workspacePath, job }
  activeWorkflowRuns.set(input.sessionID, active)
  job.start()
  try {
    const effectiveDecision: OrchestratedDecision =
      decision.mode === "orchestrated"
        ? decision
        : {
            mode: "orchestrated", operation: "research", strategy: "targeted_evidence",
            scope: "subset", coverage: "sufficient", outputs: ["report"],
            mutation: "none", verification: "normal", evaluation: "always",
            reason: "tui fallback", confidence: 0.5,
          }
    // Step-level progress for the job strip: same job.progress channel that
    // imports use, so live runs read as "Research — step 2/6 search ✓".
    // Total comes from the same plan the service executes, so counts match.
    let total = 0
    try {
      total = new WorkflowRegistry().resolve(effectiveDecision).build({ runID, decision: effectiveDecision }).nodes.length
    } catch {
      total = 0
    }
    let done = 0
    const completedRun = await new WorkflowRunService(undefined, undefined, harness).execute({
      prepared: {
        kind: "workflow",
        text: input.prepared.text,
        decision: effectiveDecision,
        runID,
        workflowID,
        goalPath: input.prepared.goalPath ?? "",
        workspacePath,
      },
      harness,
      model: input.model,
      onEvent: ({ type, stepID }) => {
        if (type === "succeeded" || type === "failed" || type === "blocked" || type === "waiting_for_approval") {
          done += 1
        }
        const status =
          type === "succeeded" ? ("done" as const)
          : type === "failed" ? ("failed" as const)
          : type === "blocked" ? ("error" as const)
          : ("processing" as const)
        job.prog.file("research", done, total, stepID ?? workflowID, status)
        input.onProgress?.({ runID, done, total, stepID: stepID ?? workflowID, status })
      },
    })
    // Terminal engine states are distinct outcomes, never silent success:
    // blocked/failed throw so the caller keeps a failed receipt with the
    // message; approval waiting stays resumable via the conversation.
    if (!job.shouldAbort()) {
      if (completedRun.status === "completed") {
        job.finish("completed", input.prepared.goalPath ? `goal ${input.prepared.goalPath}` : undefined)
        return "completed"
      }
      if (completedRun.status === "waiting_for_approval") {
        job.finish("error", "Approval needed — answer in the conversation to resume")
        return "waiting_for_approval"
      }
      if (completedRun.status === "cancelled") {
        return "cancelled"
      }
      const detail = completedRun.status === "blocked" ? completedRun.blocker : completedRun.error
      job.finish("error", `Research ${completedRun.status}${detail ? `: ${detail}` : ""}`)
      throw new Error(`Research ${completedRun.status}${detail ? `: ${detail}` : ""}`)
    }
    return "cancelled"
  } catch (err) {
    if (!job.shouldAbort()) job.finish("error", err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    if (activeWorkflowRuns.get(input.sessionID) === active) activeWorkflowRuns.delete(input.sessionID)
  }
}

/**
 * Cancel research for a session using the same JobRunner cancel-by-id path as import.
 * Also cancels the harness execution and persists run status.
 */
export async function cancelSpinosaSubmit(input: { client: unknown; sessionID: string }): Promise<boolean> {
  const active = activeWorkflowRuns.get(input.sessionID)
  if (!active) return false

  // Same control plane as import: cancel-by-id + job.cancelled event.
  active.job.cancel()

  const repository = new FileWorkflowRunRepository()
  const harness = new SpinosaKernelHarness(input.client as ConstructorParameters<typeof SpinosaKernelHarness>[0])
  // Persist the terminal state inside the shared per-run gate (same lock the
  // engine uses): otherwise a stale engine commit can slip between this
  // load and save and clobber the cancellation. Harness aborts stay outside
  // the gate; the children they address were persisted before being awaited.
  const run = await withRunLock(active.workspacePath, active.runID, async () => {
    const loaded = await repository.load(active.workspacePath, active.runID)
    if (!loaded) return undefined
    const cancelled = cancelWorkflowRun(loaded)
    await repository.save(cancelled)
    await repository.append(cancelled.workspacePath, cancelled.id, {
      at: cancelled.updatedAt,
      type: "cancelled",
      status: cancelled.status,
    })
    return cancelled
  })
  if (run) {
    // Address known children too, not just the visible parent session:
    // running steps plus fanout branches persisted at creation.
    for (const step of Object.values(run.steps)) {
      if (step.status === "running" && step.sessionID) {
        await harness.cancelExecution({ sessionID: step.sessionID }).catch(() => {})
      }
    }
    for (const sessionID of Object.values(run.branchSessions ?? {}).flat()) {
      await harness.cancelExecution({ sessionID }).catch(() => {})
    }
  }
  await harness.cancelExecution({ sessionID: input.sessionID })
  activeWorkflowRuns.delete(input.sessionID)
  return true
}

/** Cancel every in-memory workflow run (TUI exit / terminal close). */
export async function cancelAllSpinosaSubmits(client: unknown): Promise<void> {
  const ids = [...activeWorkflowRuns.keys()]
  await Promise.all(ids.map((sessionID) => cancelSpinosaSubmit({ client, sessionID })))
}

/** Cancel any Spinosa domain job (import / research / future processors) by id. */
export { cancelSpinosaJob }
