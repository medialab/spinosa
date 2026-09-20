import { describe, expect, test } from "bun:test"
import { pickLaunchUpgradeTarget } from "../src/commands/upgrade"

describe("pickLaunchUpgradeTarget", () => {
  test("beta home offers a newer stable when the beta pin is not greater", () => {
    expect(pickLaunchUpgradeTarget({
      channel: "beta",
      installed: "1.2.0-beta.12",
      betaLatest: "1.2.0-beta.12",
      stableLatest: "1.2.1",
    })).toBe("1.2.1")
  })

  test("beta home prefers a newer beta pin over a newer stable", () => {
    expect(pickLaunchUpgradeTarget({
      channel: "beta",
      installed: "1.2.0-beta.12",
      betaLatest: "1.2.0-beta.13",
      stableLatest: "1.2.1",
    })).toBe("1.2.0-beta.13")
  })

  test("stable home ignores a newer beta pin", () => {
    expect(pickLaunchUpgradeTarget({
      channel: "stable",
      installed: "1.2.0",
      betaLatest: "1.2.0-beta.13",
      stableLatest: "1.2.0",
    })).toBeUndefined()
  })

  test("stable home offers a newer stable pin", () => {
    expect(pickLaunchUpgradeTarget({
      channel: "stable",
      installed: "1.2.0",
      betaLatest: "1.2.0-beta.13",
      stableLatest: "1.2.1",
    })).toBe("1.2.1")
  })
})
