import { describe, expect, test } from "bun:test"
import { homeFooterLabels } from "../../src/component/home-footer"

describe("homeFooterLabels", () => {
  test("general home has no Sessions button", () => {
    expect(homeFooterLabels("picker")).toEqual(["Settings", "Provider", "Models", "Report bug"])
    expect(homeFooterLabels("picker")).not.toContain("Sessions")
  })

  test("workspace home includes Sessions", () => {
    expect(homeFooterLabels("workspace")).toEqual(["Settings", "Sessions", "Models", "Report bug"])
  })
})
