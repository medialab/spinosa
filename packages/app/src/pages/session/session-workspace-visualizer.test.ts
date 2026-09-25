import { expect, test } from "bun:test"
import { graphSettingsNeedFullPane } from "./raw-workspace-graph-view"

test("graph settings use the full pane when width or height is constrained", () => {
  expect(graphSettingsNeedFullPane(639, 700)).toBe(true)
  expect(graphSettingsNeedFullPane(900, 479)).toBe(true)
  expect(graphSettingsNeedFullPane(640, 480)).toBe(false)
})
