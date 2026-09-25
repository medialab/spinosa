import { describe, expect, test } from "bun:test"
import { registeredPromptProjects } from "./session-composer-controls"

describe("registeredPromptProjects", () => {
  test("lists only Spinosa workspaces, keeping opened project metadata", () => {
    expect(
      registeredPromptProjects(
        [
          { worktree: "/repo/spinosa-main", name: "spinosa-main" },
          { worktree: "/work/alpha", name: "Default Project", icon: { color: "blue" } },
          { worktree: "/work/beta", name: "Beta" },
        ],
        [
          { path: "/work/alpha", name: "Alpha workspace" },
          { path: "/work/beta", name: "Beta workspace" },
        ],
      ),
    ).toEqual([
      { worktree: "/work/alpha", name: "Alpha workspace", icon: { color: "blue" } },
      { worktree: "/work/beta", name: "Beta workspace" },
    ])
  })

  test("includes registered workspaces that are not opened yet", () => {
    expect(registeredPromptProjects([], [{ path: "/work/new", name: "New workspace" }])).toEqual([
      { worktree: "/work/new", name: "New workspace" },
    ])
  })

  test("keeps only the active opened workspace if registry lookup fails", () => {
    expect(
      registeredPromptProjects(
        [{ worktree: "/repo/source", name: "Source" }, { worktree: "/work/alpha", name: "Alpha" }],
        [],
        undefined,
        "/work/alpha",
      ),
    ).toEqual([{ worktree: "/work/alpha", name: "Alpha" }])
  })
})
