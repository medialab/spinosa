import { describe, expect, test } from "bun:test"
import type { Event } from "@spinosa/sdk/v2"
import { Deferred, Effect } from "effect"
import {
  active,
  formatUnknownError,
  globalPayloadEvent,
  isMatchingDisposeEvent,
  sid,
  traceTabs,
  waitTurn,
} from "@/cli/cmd/run/stream.transport.helpers"
import type { FooterSubagentTab } from "@/cli/cmd/run/types"

const status = {
  id: "status-1",
  type: "session.status",
  properties: {
    sessionID: "session-1",
    status: { type: "busy" },
  },
} satisfies Event

const tab: FooterSubagentTab = {
  sessionID: "child-1",
  partID: "part-1",
  callID: "call-1",
  label: "task",
  description: "inspect files",
  status: "running",
  lastUpdatedAt: 1,
}

describe("run stream transport helpers", () => {
  test("extracts session IDs and active status", () => {
    expect(sid(status)).toBe("session-1")
    expect(active(status, "session-1")).toBe(true)
    expect(active(status, "other")).toBe(false)
  })

  test("unwraps valid global events and ignores sync or malformed payloads", () => {
    expect(globalPayloadEvent({ directory: "/tmp", project: "p", payload: status })).toBe(status)
    expect(globalPayloadEvent({ payload: { type: "sync" } })).toBeUndefined()
    expect(globalPayloadEvent({ payload: { type: "not-an-event" } })).toBeUndefined()
    expect(globalPayloadEvent(undefined)).toBeUndefined()
  })

  test("matches disposal events only for selected directory", () => {
    const disposed = {
      directory: "/tmp",
      payload: { type: "server.instance.disposed" },
    }

    expect(isMatchingDisposeEvent(disposed, "/tmp")).toBe(true)
    expect(isMatchingDisposeEvent(disposed, "/other")).toBe(false)
    expect(isMatchingDisposeEvent(disposed, undefined)).toBe(false)
  })

  test("formats common unknown error values", () => {
    expect(formatUnknownError("failed")).toBe("failed")
    expect(formatUnknownError(new Error("boom"))).toBe("boom")
    expect(formatUnknownError({ message: "bad request" })).toBe("bad request")
    expect(formatUnknownError({ name: "Fault" })).toBe("Fault")
    expect(formatUnknownError({ message: "  " })).toBe("unknown error")
    expect(formatUnknownError(null)).toBe("unknown error")
  })

  test("traces added and removed subagent tabs", () => {
    const events: Array<{ type: string; data?: unknown }> = []
    const trace = {
      write: (type: string, data?: unknown) => events.push({ type, data }),
    }

    traceTabs(trace, [], [tab])
    traceTabs(trace, [tab], [])

    expect(events).toEqual([
      { type: "subagent.tab", data: { sessionID: "child-1", tab } },
      { type: "subagent.tab", data: { sessionID: "child-1", cleared: true } },
    ])
  })

  test("waits for completion or abort", async () => {
    const done = await Effect.runPromise(Deferred.make<void, unknown>())
    const controller = new AbortController()
    const pending = Effect.runPromise(waitTurn(done, controller.signal))

    controller.abort()

    expect(await pending).toBe("abort")
  })
})
