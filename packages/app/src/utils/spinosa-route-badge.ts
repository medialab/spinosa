export const SPINOSA_ROUTE_METADATA = "spinosaRoute"

export type SpinosaRouteBadge =
  | { kind: "general" }
  | { kind: "path"; label: string }
  | { kind: "workflow"; workflowID: string }

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function initialBadge(parts: readonly unknown[] | undefined): SpinosaRouteBadge | undefined {
  if (!parts) return
  let stamped = false
  for (const part of parts) {
    const route = record(record(record(part)?.metadata)?.[SPINOSA_ROUTE_METADATA])
    if (!route) continue
    stamped = true
    if (route.kind === "general" || (route.kind === "direct" && typeof route.action === "string")) {
      return { kind: "general" }
    }
    if (
      route.kind === "workflow" &&
      typeof route.workflowID === "string" &&
      typeof route.operation === "string" &&
      typeof route.strategy === "string" &&
      typeof route.runID === "string"
    ) {
      return { kind: "workflow", workflowID: route.workflowID }
    }
  }
  if (stamped) return
  if (parts.some((part) => {
    const value = record(part)
    return value?.type === "text" && value.synthetic !== true
  })) return { kind: "general" }
}

function pickedPath(parts: readonly unknown[] | undefined): string | undefined {
  let title: string | undefined
  for (const part of parts ?? []) {
    const value = record(part)
    if (value?.type !== "tool" || value.tool !== "spinosa_route") continue
    const state = record(value.state)
    if (state?.status !== "running" && state?.status !== "completed") continue
    if (typeof state.title !== "string" || !state.title.trim()) continue
    title = state.title.trim()
  }
  return title
}

export function resolveSpinosaRouteBadge(
  userParts: readonly unknown[] | undefined,
  assistantParts?: readonly unknown[],
): SpinosaRouteBadge | undefined {
  const initial = initialBadge(userParts)
  const path = pickedPath(assistantParts)
  if (path && (!initial || initial.kind === "general")) return { kind: "path", label: path }
  return initial
}
