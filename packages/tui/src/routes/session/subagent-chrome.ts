import type { RGBA } from "@opentui/core"
import type { Theme } from "../../context/theme"

/** Parent conversation leaves to Home. A child returns to its parent. */
export function sessionBackLabel(viewed: { parentID?: string | null } | undefined | null): string {
  if (viewed?.parentID) return "back"
  return "< Workspace home"
}

export function sessionBackWidth(label: string): number {
  return label.length + 4
}

export function subagentAccentPalette(theme: Theme): RGBA[] {
  return [theme.primary, theme.secondary, theme.accent, theme.info, theme.warning, theme.success]
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Stable accent for a child session. Looks random from the session id.
 * Siblings are assigned in the given order so later children dodge a taken slot.
 */
export function pickSubagentAccentIndex(sessionID: string, siblingIDs: readonly string[], paletteSize: number): number {
  if (paletteSize <= 0) return 0
  const ids = siblingIDs.includes(sessionID) ? siblingIDs : [sessionID, ...siblingIDs]
  const assigned = new Map<string, number>()
  for (const id of ids) {
    let index = hashString(id) % paletteSize
    const used = new Set(assigned.values())
    if (used.has(index) && used.size < paletteSize) {
      for (let step = 1; step < paletteSize; step++) {
        const next = (index + step) % paletteSize
        if (!used.has(next)) {
          index = next
          break
        }
      }
    }
    assigned.set(id, index)
  }
  return assigned.get(sessionID) ?? hashString(sessionID) % paletteSize
}

export function pickSubagentAccent(theme: Theme, sessionID: string, siblingIDs: readonly string[] = []): RGBA {
  const palette = subagentAccentPalette(theme)
  return palette[pickSubagentAccentIndex(sessionID, siblingIDs, palette.length)] ?? theme.primary
}

export function siblingSubagentIDs(
  sessions: readonly { id: string; parentID?: string | null; time?: { created?: number } }[],
  current: { id: string; parentID?: string | null } | undefined,
): string[] {
  if (!current?.parentID) return []
  return sessions
    .filter((session) => session.parentID === current.parentID)
    .toSorted((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || a.id.localeCompare(b.id))
    .map((session) => session.id)
}
