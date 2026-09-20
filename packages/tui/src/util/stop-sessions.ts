/** Past session open must not attach to live work. */
export function shouldResumeLiveWorkOnOpen(): boolean {
  return false
}

export function isLiveServerStatus(status: { type?: string } | undefined): boolean {
  return status !== undefined && status.type !== undefined && status.type !== "idle"
}

export function listBusySessionIDs(input: {
  sessionStatus?: Record<string, { type?: string } | undefined>
  extraIDs?: readonly string[]
}): string[] {
  const ids = new Set<string>()
  for (const [id, status] of Object.entries(input.sessionStatus ?? {})) {
    if (isLiveServerStatus(status)) ids.add(id)
  }
  for (const id of input.extraIDs ?? []) {
    if (id) ids.add(id)
  }
  return [...ids]
}

/** Leaving one session or opening another stops live work on those IDs. */
export function sessionsToStopOnOpen(input: {
  currentID?: string
  targetID: string
  sessionStatus?: Record<string, { type?: string } | undefined>
  resumeLiveWork?: boolean
}): string[] {
  const ids: string[] = []
  if (input.currentID && input.currentID !== input.targetID && isLiveServerStatus(input.sessionStatus?.[input.currentID])) {
    ids.push(input.currentID)
  }
  if (!(input.resumeLiveWork ?? shouldResumeLiveWorkOnOpen()) && isLiveServerStatus(input.sessionStatus?.[input.targetID])) {
    ids.push(input.targetID)
  }
  return ids
}

export type StopSessionFailure = { sessionID: string; stage: "cancel" | "abort"; error: unknown }

/**
 * Shared copy for every "we asked the server to stop and it refused" path.
 * A silently failed stop keeps burning tokens and writing files, so the UI must
 * never imply the run ended.
 */
export const ABORT_FAILED_TOAST = {
  variant: "error",
  title: "Could not stop the running agent",
  message: "It may still be working in the background — check the session list.",
} as const

/**
 * Stops every listed session. One failure never blocks the others, but the
 * failures are returned so the caller can tell the user.
 */
export async function stopBusySessions(input: {
  sessionIDs: readonly string[]
  abort: (sessionID: string) => Promise<unknown>
  cancelWorkflow?: (sessionID: string) => Promise<unknown>
}): Promise<StopSessionFailure[]> {
  const failures: StopSessionFailure[] = []
  await Promise.all(
    input.sessionIDs.map(async (sessionID) => {
      if (input.cancelWorkflow) {
        try {
          await input.cancelWorkflow(sessionID)
        } catch (error) {
          failures.push({ sessionID, stage: "cancel", error })
        }
      }
      try {
        await input.abort(sessionID)
      } catch (error) {
        failures.push({ sessionID, stage: "abort", error })
      }
    }),
  )
  return failures
}
