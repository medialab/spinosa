import { describe, expect, test } from "bun:test"
import { projectMenuKeys, workspaceTitleLoading } from "./prompt-project-selector"

describe("workspace title loading", () => {
  test("stays loading while the selected route has not switched", () => {
    expect(workspaceTitleLoading("/work/alpha", "/work/beta", false)).toBe(true)
    expect(workspaceTitleLoading("/work/beta", "/work/beta", false)).toBe(false)
  })

  test("waits for the workspace registry on the destination route", () => {
    expect(workspaceTitleLoading("/work/beta", "/work/beta", true)).toBe(true)
  })
})

test("registry-only workspace menu has no arbitrary-folder action", () => {
  const projects = [{ worktree: "/work/alpha" }]
  expect(projectMenuKeys(projects, [], false)).toEqual(["project::%2Fwork%2Falpha"])
})
