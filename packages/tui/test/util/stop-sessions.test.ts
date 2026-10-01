import { describe, expect, test } from "bun:test"
import {
  isLiveServerStatus,
  listBusySessionIDs,
  sessionsToStopOnOpen,
  shouldResumeLiveWorkOnOpen,
  stopBusySessions,
} from "../../src/util/stop-sessions"

describe("stop-sessions", () => {
  test("reopening a past session does not resume live work", () => {
    expect(shouldResumeLiveWorkOnOpen()).toBe(false)
  })

  test("treats only explicit non-idle server status as live", () => {
    expect(isLiveServerStatus(undefined)).toBe(false)
    expect(isLiveServerStatus({ type: "idle" })).toBe(false)
    expect(isLiveServerStatus({ type: "busy" })).toBe(true)
    expect(isLiveServerStatus({ type: "retry" })).toBe(true)
  })

  test("lists busy sessions and extra IDs", () => {
    expect(
      listBusySessionIDs({
        sessionStatus: { a: { type: "busy" }, b: { type: "idle" } },
        extraIDs: ["c"],
      }),
    ).toEqual(["a", "c"])
  })

  test("stops the current session when switching and the target when it is live", () => {
    expect(
      sessionsToStopOnOpen({
        currentID: "cur",
        targetID: "past",
        sessionStatus: { cur: { type: "busy" }, past: { type: "busy" } },
      }),
    ).toEqual(["cur", "past"])
    expect(
      sessionsToStopOnOpen({
        currentID: "cur",
        targetID: "cur",
        sessionStatus: { cur: { type: "busy" } },
      }),
    ).toEqual(["cur"])
    expect(
      sessionsToStopOnOpen({
        currentID: "cur",
        targetID: "idle",
        sessionStatus: { cur: { type: "idle" }, idle: { type: "idle" } },
      }),
    ).toEqual([])
  })

  test("aborts listed sessions and cancels workflows", async () => {
    const aborted: string[] = []
    const cancelled: string[] = []
    const failures = await stopBusySessions({
      sessionIDs: ["a", "b"],
      abort: async (id) => {
        aborted.push(id)
      },
      cancelWorkflow: async (id) => {
        cancelled.push(id)
      },
    })
    expect(aborted.sort()).toEqual(["a", "b"])
    expect(cancelled.sort()).toEqual(["a", "b"])
    expect(failures).toEqual([])
  })

  // One failure must not block the other sessions, but it must be reported:
  // a silently failed stop leaves a run consuming tokens behind the user's back.
  test("continues when abort or cancel rejects, and reports every failure", async () => {
    const aborted: string[] = []
    const failures = await stopBusySessions({
      sessionIDs: ["a", "b"],
      abort: async (id) => {
        if (id === "a") throw new Error("offline")
        aborted.push(id)
      },
      cancelWorkflow: async () => {
        throw new Error("gone")
      },
    })
    expect(aborted).toEqual(["b"])
    expect(failures.filter((failure) => failure.stage === "abort").map((failure) => failure.sessionID)).toEqual(["a"])
    expect(failures.filter((failure) => failure.stage === "cancel").map((failure) => failure.sessionID).sort()).toEqual([
      "a",
      "b",
    ])
  })
})
