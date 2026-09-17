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

export async function stopBusySessions(input: {
  sessionIDs: readonly string[]
  abort: (sessionID: string) => Promise<unknown>
  cancelWorkflow?: (sessionID: string) => Promise<unknown>
}): Promise<void> {
  await Promise.all(
    input.sessionIDs.map(async (sessionID) => {
      await input.cancelWorkflow?.(sessionID).catch(() => {})
      await input.abort(sessionID).catch(() => {})
    }),
  )
}
