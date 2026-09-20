import { describe, expect, test } from "bun:test"
import { currentWaitLabel, popWaitLabel, pushWaitLabel } from "../../src/context/wait-stack"

describe("wait stack", () => {
  test("nested waits keep the latest label on screen", () => {
    const opened = pushWaitLabel([], "Opening workspace…")
    const nested = pushWaitLabel(opened, "Loading sessions…")
    expect(currentWaitLabel(nested)).toBe("Loading sessions…")
    expect(currentWaitLabel(popWaitLabel(nested))).toBe("Opening workspace…")
    expect(currentWaitLabel(popWaitLabel(opened))).toBeUndefined()
  })
})
