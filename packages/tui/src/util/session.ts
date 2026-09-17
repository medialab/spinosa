import type { SessionStatus } from "@spinosa/sdk/v2"

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

/** Derived busy signal from transcript when server `session_status` was wiped. */
export type DerivedSessionStatus = "idle" | "working" | "compacting"

/**
 * Prefer live server status when present (including explicit idle after abort).
 * Missing server status is idle: an incomplete transcript after process restart
 * must not look like live work.
 */
export function resolveSessionRuntimeStatus(
  fromServer: SessionStatus | undefined,
  _derived?: DerivedSessionStatus,
): SessionStatus {
  if (fromServer !== undefined) return fromServer
  return { type: "idle" }
}

export function sessionIsBusy(
  fromServer: SessionStatus | undefined,
  derived?: DerivedSessionStatus,
): boolean {
  return resolveSessionRuntimeStatus(fromServer, derived).type !== "idle"
}

/**
 * True when any known session is busy (server status or transcript-derived).
 * Used to block organisation switches mid-run.
 */
export function anySessionBusy(input: {
  sessionStatus?: Record<string, SessionStatus | undefined>
  sessions?: ReadonlyArray<{ id: string }>
  derivedStatus?: (sessionID: string) => DerivedSessionStatus | undefined
}): boolean {
  const statuses = input.sessionStatus ?? {}
  const derived = input.derivedStatus ?? (() => undefined)
  for (const sessionID of Object.keys(statuses)) {
    if (sessionIsBusy(statuses[sessionID], derived(sessionID))) return true
  }
  for (const session of input.sessions ?? []) {
    if (sessionIsBusy(statuses[session.id], derived(session.id))) return true
  }
  return false
}

/**
 * Whether a session belongs to the active Spinosa directory and/or experimental
 * workspace. Never treat `workspaceID === undefined` as a match — that leaked
 * every unscoped/global session into workspace-scoped lists.
 */
export function sessionMatchesWorkspaceScope(
  session: { workspaceID?: string; directory?: string },
  scope: { workspaceDir?: string; workspaceID?: string },
): boolean {
  if (scope.workspaceID && session.workspaceID === scope.workspaceID) return true
  if (scope.workspaceDir && session.directory?.startsWith(scope.workspaceDir)) return true
  return false
}
