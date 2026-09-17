/** When the conversation boot overlay can dismiss (session synced + shell mounted). */
export function isConversationShellReady(input: {
  hasSession: boolean
  promptVisible: boolean
  promptMounted: boolean
}): boolean {
  if (!input.hasSession) return false
  if (!input.promptVisible) return true
  return input.promptMounted
}

/**
 * Session mounts call session.get; a miss normally returns Home.
 * While the boot overlay is up and sync already has the session, treat the miss
 * as transient (create/navigate race) instead of bouncing.
 */
export function shouldBounceMissingSession(input: {
  conversationBooting: boolean
  hasLocalSession: boolean
}): boolean {
  if (input.conversationBooting && input.hasLocalSession) return false
  return true
}

/** Back from a running conversation should confirm before aborting the agent. */
export function shouldConfirmLeaveBusySession(busy: boolean): boolean {
  return busy
}

export type BackNavigation = { type: "workspace"; sessionID: string } | { type: "global" }

/**
 * Top-left Back destination: a sub-agent (child) view returns straight to
 * its parent conversation — identical to the Parent button. The child keeps
 * running in background, so the stop-confirm gate must not apply. Anything
 * else leaves to Home, where the busy-session gate decides about aborting.
 */
export function resolveBackNavigation(
  viewed: { parentID?: string | null } | undefined | null,
): BackNavigation {
  if (viewed?.parentID) return { type: "workspace", sessionID: viewed.parentID }
  return { type: "global" }
}
