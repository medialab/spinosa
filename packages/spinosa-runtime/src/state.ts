// WP10: frozen legacy transitions (phaseIndex execution). No production
// caller remains — the engine (engine.ts) owns all new-run transitions.
// Kept for the legacy run decoder + historical tests.
import type { ExecutionRequest, ResearchRun, ResearchRunEvent, ResearchRunStatus } from "./model"
import { agentsForRoute, type RouteClass } from "./routes"

const TOOLSET = ["read", "glob", "grep", "write"] as const

function now(): string {
  return new Date().toISOString()
}

function statusForAgent(agent: string): ResearchRunStatus {
  if (agent.includes("search") || agent.includes("mapper") || agent.includes("janitor") || agent.includes("overseer")) return "searching"
  if (agent.includes("analyst") || agent.includes("serendippo")) return "analysing"
  if (agent.includes("writer")) return "writing"
  if (agent.includes("verifier")) return "verifying"
  if (agent.includes("evaluator")) return "evaluating"
  return "failed"
}

export function createResearchRun(input: {
  id: string
  workspacePath: string
  prompt: string
  route: RouteClass
  createdAt?: string
}): ResearchRun {
  const createdAt = input.createdAt ?? now()
  return {
    id: input.id,
    workspacePath: input.workspacePath,
    prompt: input.prompt,
    route: input.route,
    status: input.route === "fast_path" ? "completed" : "classified",
    phaseIndex: 0,
    createdAt,
    updatedAt: createdAt,
  }
}

export function initialEvents(run: ResearchRun): ResearchRunEvent[] {
  const events: ResearchRunEvent[] = [
    { at: run.createdAt, type: "created", status: "created" },
    { at: run.createdAt, type: "classified", status: run.status, detail: run.route },
  ]
  if (run.status === "completed") events.push({ at: run.createdAt, type: "completed", status: "completed", detail: "fast_path" })
  return events
}

export function isTerminal(run: ResearchRun): boolean {
  return run.status === "completed" || run.status === "blocked" || run.status === "failed" || run.status === "cancelled"
}

export function nextExecution(run: ResearchRun): ExecutionRequest | undefined {
  if (isTerminal(run)) return
  const agent = agentsForRoute(run.route)[run.phaseIndex]
  if (!agent) return
  return {
    runID: run.id,
    workspacePath: run.workspacePath,
    agent,
    prompt: run.prompt,
    allowedTools: TOOLSET,
  }
}

export function beginExecution(run: ResearchRun, at = now()): ResearchRun {
  const execution = nextExecution(run)
  if (!execution) return run
  return { ...run, status: statusForAgent(execution.agent), updatedAt: at }
}

export function completeExecution(run: ResearchRun, at = now()): ResearchRun {
  if (isTerminal(run)) return run
  const nextIndex = run.phaseIndex + 1
  const completed = nextIndex >= agentsForRoute(run.route).length
  return {
    ...run,
    phaseIndex: nextIndex,
    status: completed ? "completed" : "classified",
    updatedAt: at,
  }
}

export function blockRun(run: ResearchRun, blocker: string, at = now()): ResearchRun {
  if (isTerminal(run)) return run
  return { ...run, status: "blocked", blocker, updatedAt: at }
}

export function failRun(run: ResearchRun, error: string, at = now()): ResearchRun {
  if (isTerminal(run)) return run
  return { ...run, status: "failed", error, updatedAt: at }
}

export function cancelRun(run: ResearchRun, at = now()): ResearchRun {
  if (isTerminal(run)) return run
  return { ...run, status: "cancelled", updatedAt: at }
}
