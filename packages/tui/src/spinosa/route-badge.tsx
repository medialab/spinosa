import { createStore, produce } from "solid-js/store"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"

/**
 * Conversation route badge: manifests transient routing state and, for
 * orchestrated workflows, which step is running. Workflow identity is
 * attached at submit time as part metadata (same mechanism
 * as the `ignored` / `spinosaSilent` markers), so it survives reload and
 * needs no message-id matching. Live step progress arrives via the
 * `onProgress` callback threaded through `executeSpinosaSubmit`.
 */

export const SPINOSA_ROUTE_METADATA = "spinosaRoute"

export type RouteBadgeInfo =
  | { kind: "general"; routedBy?: "rules" | "model"; confidence?: number }
  | {
      kind: "workflow"
      workflowID: string
      operation: string
      strategy: string
      runID: string
      routedBy?: "rules" | "model"
      confidence?: number
    }
  // Transient TUI-local states for the outbound queue (never persisted to
  // part metadata — the badge disappears or flips to workflow once routed).
  | { kind: "queued" }
  | { kind: "steered" }
  | { kind: "evaluating" }
  | { kind: "interrupted" }

export type RouteStepProgress = {
  done: number
  total: number
  stepID: string
  status: "done" | "failed" | "error" | "processing"
}

function partMetadata(part: unknown): Record<string, unknown> | undefined {
  if (!part || typeof part !== "object" || !("metadata" in part)) return
  const value = (part as { metadata?: unknown }).metadata
  if (!value || typeof value !== "object") return
  return value as Record<string, unknown>
}

/** Extract route info from synced message parts (tolerates unknown shapes). */
export function routeBadgeFromParts(parts: readonly unknown[] | undefined): RouteBadgeInfo | undefined {
  if (!parts) return
  for (const part of parts) {
    const info = partMetadata(part)?.[SPINOSA_ROUTE_METADATA]
    if (!info || typeof info !== "object") continue
    const v = info as Record<string, unknown>
    const routedBy = v.routedBy === "model" || v.routedBy === "rules" ? v.routedBy : undefined
    const confidence = typeof v.confidence === "number" ? v.confidence : undefined
    // Older transcript parts used { kind: "direct", action: ... }. Normalize
    // those persisted rows into the current general-answer vocabulary.
    if (v.kind === "general" || (v.kind === "direct" && typeof v.action === "string")) {
      return {
        kind: "general",
        ...(routedBy ? { routedBy } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      }
    }
    if (
      v.kind === "workflow" &&
      typeof v.workflowID === "string" &&
      typeof v.operation === "string" &&
      typeof v.strategy === "string" &&
      typeof v.runID === "string"
    ) {
      return {
        kind: "workflow",
        workflowID: v.workflowID,
        operation: v.operation,
        strategy: v.strategy,
        runID: v.runID,
        ...(routedBy ? { routedBy } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      }
    }
  }
  return
}

// Live per-run step progress (in-memory; run.json stays authoritative).
// Bounded: oldest entries evict past MAX_TRACKED_RUNS so long sessions leak
// nothing; values are sanitized because the feed crosses module boundaries.
const MAX_TRACKED_RUNS = 100
const [progressByRun, setProgressByRun] = createStore<Record<string, RouteStepProgress>>({})

export function setRouteProgress(runID: string, progress: RouteStepProgress): void {
  setProgressByRun(runID, {
    done: Number.isFinite(progress.done) ? progress.done : 0,
    total: Number.isFinite(progress.total) ? progress.total : 0,
    stepID: typeof progress.stepID === "string" ? progress.stepID : "",
    status: progress.status,
  })
  const keys = Object.keys(progressByRun)
  if (keys.length > MAX_TRACKED_RUNS) {
    const drop = keys.slice(0, keys.length - MAX_TRACKED_RUNS)
    setProgressByRun(
      produce((draft) => {
        for (const key of drop) delete draft[key]
      }),
    )
  }
}

export function trackedRunCount(): number {
  return Object.keys(progressByRun).length
}

export function routeProgress(runID: string): RouteStepProgress | undefined {
  return progressByRun[runID]
}

function shortWorkflow(id: string): string {
  return id.replace(/^research\./, "").replace(/_/g, " ")
}

export function shortStepLabel(stepID: string): string {
  const base = (stepID.split(":")[0] ?? stepID).replace(/^spinosa-/, "")
  // Fanout nodes complete as one graph step but run N branches in parallel.
  if (base.endsWith("-fanout")) return `${base.replace(/-fanout$/, "")} × parallel`
  return base
}

function shortAgent(stepID: string): string {
  return shortStepLabel(stepID)
}

export function routeBadgeLabel(info: RouteBadgeInfo): string {
  if (info.kind === "general") return "General answer"
  if (info.kind === "queued") return "○ queued"
  if (info.kind === "steered") return "→ steered"
  if (info.kind === "evaluating") return "Evaluating"
  if (info.kind === "interrupted") return "⛔ Interrupted"
  return `◈ ${shortWorkflow(info.workflowID)}`
}

/** Small chip rendered under the user message timestamp row. */
export function RouteBadge(props: { info: RouteBadgeInfo }) {
  const { theme } = useTheme()
  const progress = () =>
    props.info.kind === "workflow" ? routeProgress(props.info.runID) : undefined

  const tone = () => {
    if (props.info.kind === "general") return theme.textMuted
    if (props.info.kind === "queued") return theme.textMuted
    if (props.info.kind === "steered") return theme.primary
    if (props.info.kind === "evaluating") return theme.textMuted
    if (props.info.kind === "interrupted") return theme.error
    const p = progress()
    if (!p) return theme.primary
    if (p.status === "done" && p.done >= p.total && p.total > 0) return theme.success
    if (p.status === "failed" || p.status === "error") return theme.error
    return theme.primary
  }

  // Badge shows state only — never why the model decided. No reasons, no
  // via-model/rules provenance, no confidence. The single exception is live
  // workflow step progress (run-state signaling, not an explanation).
  const detail = () => {
    if (props.info.kind === "queued") return "waiting for its turn"
    if (props.info.kind === "steered") return "will go next"
    if (props.info.kind === "evaluating" || props.info.kind === "interrupted") return undefined
    if (props.info.kind === "general") return undefined
    const p = progress()
    if (!p || p.total === 0) return undefined
    const done = p.status === "done" && p.done >= p.total ? "✓ " : ""
    return `${done}${p.done}/${p.total} · ${shortAgent(p.stepID)}`
  }

  return (
    // No vertical padding: the message header row owns the spacing, so the
    // timestamp no longer costs an extra line when a badge is present.
    <box flexDirection="row" gap={1}>
      <text fg={tone()}>●</text>
      <text fg={theme.text}>
        <span style={{ bold: true }}>{routeBadgeLabel(props.info)}</span>
      </text>
      <Show when={detail()}>
        <text fg={theme.textMuted}>{detail()}</text>
      </Show>
    </box>
  )
}
