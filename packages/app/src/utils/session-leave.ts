export const SESSION_LEAVE_EVENT = "spinosa:session-leave"

export function pauseSessionFollowups(sessionID: string) {
  const detail: { sessionID: string; paused: boolean; previous?: boolean } = { sessionID, paused: true }
  window.dispatchEvent(new CustomEvent(SESSION_LEAVE_EVENT, { detail }))
  return () => window.dispatchEvent(new CustomEvent(SESSION_LEAVE_EVENT, {
    detail: { sessionID, paused: detail.previous ?? false },
  }))
}
