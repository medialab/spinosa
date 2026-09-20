import { describe, expect, test } from "bun:test"
import {
  anySessionBusy,
  isDefaultTitle,
  resolveSessionRuntimeStatus,
  sessionIsBusy,
  sessionMatchesWorkspaceScope,
} from "../../src/util/session"

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("trusts explicit server idle over transcript-derived working", () => {
    expect(resolveSessionRuntimeStatus({ type: "idle" }, "working")).toEqual({ type: "idle" })
    expect(sessionIsBusy({ type: "idle" }, "working")).toBeFalse()
    expect(sessionIsBusy({ type: "busy" }, "idle")).toBeTrue()
    expect(sessionIsBusy({ type: "idle" }, "idle")).toBeFalse()
  })

  test("missing server status is idle so a past session does not look live", () => {
    expect(resolveSessionRuntimeStatus(undefined, "working")).toEqual({ type: "idle" })
    expect(resolveSessionRuntimeStatus(undefined, "compacting")).toEqual({ type: "idle" })
    expect(sessionIsBusy(undefined, "working")).toBeFalse()
  })

  test("blocks organisation switch when any session is busy", () => {
    expect(
      anySessionBusy({
        sessionStatus: { a: { type: "idle" }, b: { type: "busy" } },
        sessions: [{ id: "a" }, { id: "b" }],
        derivedStatus: (id) => (id === "b" ? "working" : "idle"),
      }),
    ).toBeTrue()
    expect(
      anySessionBusy({
        sessionStatus: { a: { type: "idle" } },
        sessions: [{ id: "a" }],
        derivedStatus: () => "idle",
      }),
    ).toBeFalse()
  })

  test("scopes sessions to workspace directory without matching undefined workspace IDs", () => {
    const workspaceDir = "/tmp/spinosa/workspace-a"
    const sessions = [
      { id: "in", directory: `${workspaceDir}/chat`, workspaceID: undefined },
      { id: "exact", directory: workspaceDir, workspaceID: undefined },
      { id: "out", directory: "/tmp/other", workspaceID: undefined },
      { id: "wrk", directory: "/tmp/other", workspaceID: "wrk_a" },
    ]

    const filtered = sessions.filter((s) =>
      sessionMatchesWorkspaceScope(s, { workspaceDir, workspaceID: undefined }),
    )

    expect(filtered.map((s) => s.id)).toEqual(["in", "exact"])
  })

  test("does not treat a sibling directory as the same workspace", () => {
    expect(
      sessionMatchesWorkspaceScope(
        { directory: "/tmp/spinosa/workspace-ab", workspaceID: undefined },
        { workspaceDir: "/tmp/spinosa/workspace-a", workspaceID: undefined },
      ),
    ).toBeFalse()
  })

  test("rejects a session bound to a different workspace ID even if the directory matches", () => {
    expect(
      sessionMatchesWorkspaceScope(
        { directory: "/tmp/spinosa/ws", workspaceID: "wrk_b" },
        { workspaceDir: "/tmp/spinosa/ws", workspaceID: "wrk_a" },
      ),
    ).toBeFalse()
  })

  test("matches experimental workspace ID when selected", () => {
    expect(
      sessionMatchesWorkspaceScope(
        { directory: "/tmp/other", workspaceID: "wrk_a" },
        { workspaceDir: "/tmp/spinosa/ws", workspaceID: "wrk_a" },
      ),
    ).toBeTrue()
    expect(
      sessionMatchesWorkspaceScope(
        { directory: "/tmp/other", workspaceID: "wrk_b" },
        { workspaceDir: "/tmp/spinosa/ws", workspaceID: "wrk_a" },
      ),
    ).toBeFalse()
  })
})
