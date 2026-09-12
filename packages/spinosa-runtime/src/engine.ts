// WP1: Pure workflow engine — replaces phaseIndex + statusForAgent().
// State transitions depend only on step type, dependency state, validated
// outcome, retry policy, gate result, and approval state. Never infer state
// from an agent name. All functions are pure (no I/O).

import type { StepOutcome, WorkflowRun, WorkflowStepStatus } from "./model"
import type { OrchestratedDecision } from "./routing"
import type { WorkflowNode, WorkflowPlan } from "./workflow"

function now(at?: string): string {
  return at ?? new Date().toISOString()
}

export function isWorkflowTerminal(run: WorkflowRun): boolean {
  return (
    run.status === "completed" ||
    run.status === "blocked" ||
    run.status === "failed" ||
    run.status === "cancelled"
  )
}

export function createWorkflowRun(input: {
  id: string
  workspacePath: string
  parentSessionID: string
  prompt: string
  decision: OrchestratedDecision
  plan: WorkflowPlan
  createdAt?: string
}): WorkflowRun {
  const createdAt = input.createdAt ?? new Date().toISOString()
  const steps: WorkflowRun["steps"] = {}
  for (const node of input.plan.nodes) {
    steps[node.id] = { id: node.id, status: "pending", attempt: 0 }
  }
  return {
    schemaVersion: 2,
    id: input.id,
    workspacePath: input.workspacePath,
    parentSessionID: input.parentSessionID,
    prompt: input.prompt,
    decision: input.decision,
    workflowID: input.plan.id,
    workflowVersion: input.plan.version,
    status: "planned",
    steps,
    artifacts: [],
    createdAt,
    updatedAt: createdAt,
  }
}

function dependenciesSucceeded(run: WorkflowRun, node: WorkflowNode): boolean {
  return node.dependsOn.every((dep) => run.steps[dep]?.status === "succeeded")
}

function isPendingLike(status: WorkflowStepStatus): boolean {
  return status === "pending" || status === "retrying"
}

/** Every pending node whose dependencies have succeeded. Multiple = parallel. */
export function runnableSteps(run: WorkflowRun, plan: WorkflowPlan): readonly WorkflowNode[] {
  if (isWorkflowTerminal(run)) return []
  if (run.status !== "planned" && run.status !== "running") return []
  return plan.nodes.filter((node) => {
    const state = run.steps[node.id]
    if (!state || !isPendingLike(state.status)) return false
    return dependenciesSucceeded(run, node)
  })
}

export function startStep(
  run: WorkflowRun,
  stepID: string,
  execution: { sessionID?: string; executionID?: string },
  at?: string,
): WorkflowRun {
  const state = run.steps[stepID]
  if (!state || isWorkflowTerminal(run)) return run
  if (state.status !== "pending" && state.status !== "retrying") return run
  const stamp = now(at)
  return {
    ...run,
    status: "running",
    steps: {
      ...run.steps,
      [stepID]: {
        ...state,
        status: "running",
        attempt: state.attempt + 1,
        sessionID: execution.sessionID ?? state.sessionID,
        executionID: execution.executionID ?? state.executionID,
        startedAt: stamp,
      },
    },
    updatedAt: stamp,
  }
}

export function completeStep(
  run: WorkflowRun,
  stepID: string,
  outcome: StepOutcome,
  at?: string,
): WorkflowRun {
  const state = run.steps[stepID]
  if (!state || isWorkflowTerminal(run)) return run
  const stamp = now(at)
  if (outcome.status === "succeeded") {
    const steps = {
      ...run.steps,
      [stepID]: { ...state, status: "succeeded" as const, completedAt: stamp, outcome },
    }
    const artifacts = [...run.artifacts, ...outcome.artifacts]
    return { ...run, steps, artifacts, updatedAt: stamp }
  }
  if (outcome.status === "blocked") {
    return {
      ...run,
      status: "blocked",
      blocker: outcome.blocker,
      steps: {
        ...run.steps,
        [stepID]: { ...state, status: "blocked" as const, completedAt: stamp, outcome },
      },
      updatedAt: stamp,
    }
  }
  if (outcome.status === "waiting_for_approval") {
    return {
      ...run,
      status: "waiting_for_approval",
      steps: {
        ...run.steps,
        [stepID]: { ...state, status: "waiting_for_approval" as const, outcome },
      },
      updatedAt: stamp,
    }
  }
  // failed — engine records; retry policy enforced by caller via retryStep/blockRun
  return {
    ...run,
    steps: {
      ...run.steps,
      [stepID]: { ...state, status: "failed" as const, completedAt: stamp, outcome },
    },
    updatedAt: stamp,
  }
}

/**
 * Mark a failed step retryable (caller checks node.retry.maxAttempts).
 * Accepts "failed" (pre-startStep outcome) and "running" (post-startStep:
 * execute() applies startStep before the outcome arrives; resume() recovers
 * crashed "running" steps). Anything else is a no-op.
 */
export function retryStep(run: WorkflowRun, stepID: string, _reason: string, at?: string): WorkflowRun {
  const state = run.steps[stepID]
  if (!state || isWorkflowTerminal(run)) return run
  if (state.status !== "failed" && state.status !== "running") return run
  const stamp = now(at)
  return {
    ...run,
    status: "running",
    steps: {
      ...run.steps,
      [stepID]: { ...state, status: "retrying" as const },
    },
    updatedAt: stamp,
  }
}

/** NOTE: named blockWorkflowRun to avoid colliding with legacy state.blockRun (WP10 removes legacy). */
export function blockWorkflowRun(run: WorkflowRun, reason: string, at?: string): WorkflowRun {
  if (isWorkflowTerminal(run)) return run
  const stamp = now(at)
  return { ...run, status: "blocked", blocker: reason, updatedAt: stamp }
}

export function failWorkflowRun(run: WorkflowRun, error: string, at?: string): WorkflowRun {
  if (isWorkflowTerminal(run)) return run
  const stamp = now(at)
  return { ...run, status: "failed", error, updatedAt: stamp }
}

export function cancelWorkflowRun(run: WorkflowRun, at?: string): WorkflowRun {
  if (isWorkflowTerminal(run)) return run
  const stamp = now(at)
  return { ...run, status: "cancelled", updatedAt: stamp }
}

/** Terminal completion — caller must have verified all required steps/gates. */
export function completeRun(run: WorkflowRun, at?: string): WorkflowRun {
  if (isWorkflowTerminal(run)) return run
  const stamp = now(at)
  return { ...run, status: "completed", updatedAt: stamp }
}

/**
 * Crash-recovery helper: classify a step marked running at resume time.
 * - succeeded stays; valid artifact → caller marks succeeded;
 * - missing artifact → retryStep (or blockRun past max attempts).
 */
export function needsRecoveryValidation(run: WorkflowRun, stepID: string): boolean {
  return run.steps[stepID]?.status === "running"
}
