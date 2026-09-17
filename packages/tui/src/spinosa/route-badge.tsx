import { Show } from "solid-js"
import { useTheme } from "../context/theme"

/**
 * Conversation route badge: manifests transient outbound state and, for
 * persisted user messages, the general-prompt (or historical workflow)
 * identity stamped at submit as part metadata.
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
  // part metadata).
  | { kind: "queued" }
  | { kind: "steered" }
  | { kind: "sent"; stale?: boolean }
  | { kind: "interrupted" }
  | { kind: "failed" }

function partMetadata(part: unknown): Record<string, unknown> | undefined {
  if (!part || typeof part !== "object" || !("metadata" in part)) return
  const value = (part as { metadata?: unknown }).metadata
  if (!value || typeof value !== "object") return
  return value as Record<string, unknown>
}

/** True when parts hold a genuine user text payload (not just scaffolding). */
function hasUserTextContent(parts: readonly unknown[] | undefined): boolean {
  if (!parts) return false
  return parts.some((part) => {
    if (!part || typeof part !== "object") return false
    const candidate = part as { type?: unknown; synthetic?: unknown }
    return candidate.type === "text" && candidate.synthetic !== true
  })
}

/** Extract route info from synced message parts (tolerates unknown shapes). */
export function routeBadgeFromParts(parts: readonly unknown[] | undefined): RouteBadgeInfo | undefined {
  if (!parts) return
  let sawRouteKey = false
  for (const part of parts) {
    const info = partMetadata(part)?.[SPINOSA_ROUTE_METADATA]
    if (!info || typeof info !== "object") continue
    sawRouteKey = true
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
  // Fallback: a genuine user text message admitted with no routing verdict
  // still manifests a badge — never an empty tag.
  // Parts that carry the route key (even unparsable/transient kinds) keep
  // the legacy undefined so malformed verdicts stay invisible, not general.
  if (!sawRouteKey && hasUserTextContent(parts)) return { kind: "general" }
  return
}

function shortWorkflow(id: string): string {
  return id.replace(/^research\./, "").replace(/_/g, " ")
}

export function routeBadgeLabel(info: RouteBadgeInfo): string {
  if (info.kind === "general") return "General prompt"
  if (info.kind === "queued") return "○ queued"
  if (info.kind === "steered") return "→ steered"
  if (info.kind === "sent") return "✓ Sent"
  if (info.kind === "interrupted") return "⛔ Interrupted"
  if (info.kind === "failed") return "Failed"
  return `◈ ${shortWorkflow(info.workflowID)}`
}

/** Small chip rendered under the user message timestamp row. */
export function RouteBadge(props: { info: RouteBadgeInfo }) {
  const { theme } = useTheme()

  const tone = () => {
    if (props.info.kind === "general") return theme.success
    if (props.info.kind === "queued") return theme.textMuted
    if (props.info.kind === "steered") return theme.primary
    if (props.info.kind === "sent") return theme.textMuted
    if (props.info.kind === "interrupted") return theme.error
    if (props.info.kind === "failed") return theme.error
    return theme.primary
  }

  const detail = () => {
    if (props.info.kind === "queued") return "waiting for its turn"
    if (props.info.kind === "steered") return "will go next"
    if (props.info.kind === "sent" && props.info.stale) return "confirming…"
    return undefined
  }

  return (
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
