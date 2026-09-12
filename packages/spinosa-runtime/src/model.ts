import type { RouteClass } from "./routes"
import type { RouteDecision } from "./routing"

// --- Legacy model (WP10 removes; migration.ts decodes into V2) ---

export const RESEARCH_RUN_STATUSES = [
  "created",
  "classified",
  "searching",
  "analysing",
  "writing",
  "verifying",
  "evaluating",
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const

export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number]

export type ResearchRun = {
  id: string
  workspacePath: string
  prompt: string
  route: RouteClass
  status: ResearchRunStatus
  phaseIndex: number
  createdAt: string
  updatedAt: string
  blocker?: string
  error?: string
}

export type ResearchRunEvent = {
  at: string
  type: "created" | "classified" | "execution_started" | "execution_completed" | "blocked" | "failed" | "cancelled" | "completed"
  status: ResearchRunStatus
  detail?: string
}

export type ExecutionRequest = {
  runID: string
  workspacePath: string
  agent: string
  prompt: string
  allowedTools: readonly string[]
}

// --- Workflow V2 model (WP1; executable control plane) ---
// run.json carries this shape with schemaVersion 2. Goal Markdown mirrors it
// for humans; run.json remains the authority. Do not store base64 attachments
// here — only safe descriptors (file name, MIME, workspace-relative path).

export type WorkflowRunStatus =
  | "created"
  | "routing"
  | "planned"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "skipped"
  | "retrying"
  | "waiting_for_approval"

export type ArtifactRef = {
  kind:
    | "goal"
    | "evidence"
    | "analysis"
    | "serendipity"
    | "visualization"
    | "report"
    | "verification"
    | "evaluation"
    | "coverage"
    | "map"
    | "extraction"
  path: string
  producedBy: string
  status?: string
  metadata?: Record<string, unknown>
}

export type StepOutcome =
  | {
      status: "succeeded"
      artifacts: readonly ArtifactRef[]
      signals?: Record<string, unknown>
      metrics?: Record<string, number>
    }
  | {
      status: "failed"
      error: string
      retryable: boolean
    }
  | {
      status: "blocked"
      blocker: string
    }
  | {
      status: "waiting_for_approval"
      approvalID: string
      summary: string
    }

export type WorkflowStepState = {
  id: string
  status: WorkflowStepStatus
  attempt: number
  sessionID?: string
  executionID?: string
  startedAt?: string
  completedAt?: string
  outcome?: StepOutcome
}

export type WorkflowRun = {
  schemaVersion: 2
  id: string
  workspacePath: string
  parentSessionID: string
  prompt: string
  decision: RouteDecision
  workflowID: string
  workflowVersion: number
  status: WorkflowRunStatus
  steps: Record<string, WorkflowStepState>
  artifacts: readonly ArtifactRef[]
  createdAt: string
  updatedAt: string
  blocker?: string
  error?: string
}

export type WorkflowRunEvent =
  | { at: string; type: "created"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "routed"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "plan_created"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "step_started"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "step_succeeded"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "step_failed"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "step_retried"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "gate_passed"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "gate_failed"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "approval_requested"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "approval_resolved"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "completed"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "blocked"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "failed"; status: WorkflowRunStatus; detail?: string }
  | { at: string; type: "cancelled"; status: WorkflowRunStatus; detail?: string }
  // Legacy execution markers kept readable for old events.jsonl files.
  | { at: string; type: "classified" | "execution_started" | "execution_completed"; status: WorkflowRunStatus; detail?: string }
