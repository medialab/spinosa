import { describe, expect, test } from "bun:test"
import { availableSpinosaWorkspaces } from "./new-session-workspace-controller"

describe("available Spinosa workspaces", () => {
  test("uses registered metadata and excludes unavailable paths", () => {
    expect(
      availableSpinosaWorkspaces([
        { path: "/repo/spinosa-main", projectName: "Spinosa source", presence: "invalid" },
        { path: "/work/alpha", projectName: "Alpha", presence: "present" },
        { path: "/work/beta", projectName: "Beta workspace", presence: "legacy" },
        { path: "/work/moved", projectName: "Moved", presence: "moved" },
        { path: "/work/unknown", projectName: "Unknown", presence: "unknown" },
      ]),
    ).toEqual([
      { path: "/work/alpha", name: "Alpha" },
      { path: "/work/beta", name: "Beta workspace" },
    ])
  })

  test("deduplicates paths from global registry metadata", () => {
    expect(
      availableSpinosaWorkspaces([
        { path: "/work/alpha", projectName: "Alpha", presence: "present" },
        { path: "/work/alpha/", projectName: "Duplicate", presence: "legacy" },
      ]),
    ).toEqual([{ path: "/work/alpha", name: "Alpha" }])
  })
})
