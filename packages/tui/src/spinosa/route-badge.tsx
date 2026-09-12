import { createStore, produce } from "solid-js/store"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"

/**
 * Conversation route badge: manifests in the transcript whether a request
 * took the fast path or an orchestrated workflow — and, for workflows, which
 * step is running. Attached at submit time as part metadata (same mechanism
 * as the `ignored` / `spinosaSilent` markers), so it survives reload and
 * needs no message-id matching. Live step progress arrives via the
 * `onProgress` callback threaded through `executeSpinosaSubmit`.
 */

export const SPINOSA_ROUTE_METADATA = "spinosaRoute"

export type RouteBadgeInfo =
  | { kind: "direct"; action: string; reason?: string; routedBy?: "rules" | "model"; confidence?: number }
  | {
      kind: "workflow"
      workflowID: string
      operation: string
      strategy: string
      runID: string
      routedBy?: "rules" | "model"
      confidence?: number
    }

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
    if (v.kind === "direct" && typeof v.action === "string") {
      return {
        kind: "direct",
        action: v.action,
        ...(typeof v.reason === "string" ? { reason: v.reason } : {}),
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

/** Small chip rendered under the user message timestamp row. */
export function RouteBadge(props: { info: RouteBadgeInfo }) {
  const { theme } = useTheme()
  const progress = () =>
    props.info.kind === "workflow" ? routeProgress(props.info.runID) : undefined

  const tone = () => {
    if (props.info.kind === "direct") return theme.textMuted
    const p = progress()
    if (!p) return theme.primary
    if (p.status === "done" && p.done >= p.total && p.total > 0) return theme.success
    if (p.status === "failed" || p.status === "error") return theme.error
    return theme.primary
  }

  const label = () => {
    if (props.info.kind === "direct") return `⚡ fast · ${props.info.action}`
    return `◈ ${shortWorkflow(props.info.workflowID)}`
  }

  /** Routing provenance: declares whether a model call classified this. */
  const via = () => {
    if (props.info.routedBy === "model") {
      const conf =
        props.info.confidence !== undefined ? ` · ${props.info.confidence.toFixed(2)}` : ""
      return `via model${conf}`
    }
    if (props.info.routedBy === "rules") return "via rules"
    return undefined
  }

  const detail = () => {
    if (props.info.kind === "direct") {
      return [props.info.reason, via()].filter(Boolean).join(" · ") || undefined
    }
    const base = (() => {
      const p = progress()
      if (!p || p.total === 0) return `${props.info.operation} · ${props.info.strategy}`
      const done = p.status === "done" && p.done >= p.total ? "✓ " : ""
      return `${done}${p.done}/${p.total} · ${shortAgent(p.stepID)}`
    })()
    return [base, via()].filter(Boolean).join(" · ")
  }

  return (
    // No vertical padding: the message header row owns the spacing, so the
    // timestamp no longer costs an extra line when a badge is present.
    <box flexDirection="row" gap={1}>
      <text fg={tone()}>●</text>
      <text fg={theme.text}>
        <span style={{ bold: true }}>{label()}</span>
      </text>
      <Show when={detail()}>
        <text fg={theme.textMuted}>{detail()}</text>
      </Show>
    </box>
  )
}
