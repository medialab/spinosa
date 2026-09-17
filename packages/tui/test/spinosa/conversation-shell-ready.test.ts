import { describe, expect, test } from "bun:test"
import {
  isConversationShellReady,
  resolveBackNavigation,
  shouldBounceMissingSession,
  shouldConfirmLeaveBusySession,
} from "../../src/routes/session/conversation-shell-ready"

describe("isConversationShellReady", () => {
  test("waits for session sync", () => {
    expect(
      isConversationShellReady({ hasSession: false, promptVisible: true, promptMounted: false }),
    ).toBe(false)
  })

  test("dismisses boot overlay when permissions block the prompt", () => {
    expect(
      isConversationShellReady({ hasSession: true, promptVisible: false, promptMounted: false }),
    ).toBe(true)
  })

  test("waits for prompt mount when the prompt is visible", () => {
    expect(
      isConversationShellReady({ hasSession: true, promptVisible: true, promptMounted: false }),
    ).toBe(false)
    expect(
      isConversationShellReady({ hasSession: true, promptVisible: true, promptMounted: true }),
    ).toBe(true)
  })
})

describe("shouldBounceMissingSession", () => {
  test("does not bounce Home while booting with a local seed", () => {
    expect(
      shouldBounceMissingSession({ conversationBooting: true, hasLocalSession: true }),
    ).toBe(false)
  })

  test("bounces when the session is missing after boot", () => {
    expect(
      shouldBounceMissingSession({ conversationBooting: false, hasLocalSession: false }),
    ).toBe(true)
    expect(
      shouldBounceMissingSession({ conversationBooting: true, hasLocalSession: false }),
    ).toBe(true)
  })
})

describe("shouldConfirmLeaveBusySession", () => {
  test("requires confirm only while the agent is busy", () => {
    expect(shouldConfirmLeaveBusySession(true)).toBe(true)
    expect(shouldConfirmLeaveBusySession(false)).toBe(false)
  })
})

describe("resolveBackNavigation", () => {
  test("sub-agent views return straight to the parent (like Parent)", () => {
    expect(resolveBackNavigation({ parentID: "ses_parent" })).toEqual({
      type: "workspace",
      sessionID: "ses_parent",
    })
  })

  test("root sessions leave to Home regardless of busy state", () => {
    expect(resolveBackNavigation({ parentID: null })).toEqual({ type: "global" })
    expect(resolveBackNavigation({})).toEqual({ type: "global" })
    expect(resolveBackNavigation(undefined)).toEqual({ type: "global" })
  })
})
