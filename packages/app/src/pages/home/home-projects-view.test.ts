import { expect, test } from "bun:test"
import { homeServerCollapseState } from "./home-projects-view"

test("server collapse state is independent of server selection", () => {
  expect(homeServerCollapseState(true, true)).toEqual({ disabled: false, expanded: false })
  expect(homeServerCollapseState(false, true)).toEqual({ disabled: false, expanded: true })
  expect(homeServerCollapseState(false, false)).toEqual({ disabled: true, expanded: undefined })
})
