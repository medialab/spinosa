import { expect, test } from "bun:test"
import { workspaceActionsVisible } from "./helpers"

test("workspace actions stay visible for touch and an open menu", () => {
  expect(workspaceActionsVisible(false, false)).toBe(false)
  expect(workspaceActionsVisible(false, true)).toBe(true)
  expect(workspaceActionsVisible(true, false)).toBe(true)
})
