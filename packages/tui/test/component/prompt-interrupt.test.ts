import { describe, expect, test } from "bun:test"
import { ESC_ARM_WINDOW_MS, escConfirmStop } from "../../src/component/prompt/interrupt"

describe("escConfirmStop", () => {
  test("unarmed states never confirm", () => {
    expect(escConfirmStop(0, undefined, "evaluation:one", 1_000)).toBe(false)
    expect(escConfirmStop(undefined, undefined, "evaluation:one", 1_000)).toBe(false)
  })

  test("second press inside 10s confirms the stop", () => {
    expect(escConfirmStop(1_000, "evaluation:one", "evaluation:one", 1_000 + ESC_ARM_WINDOW_MS - 1)).toBe(true)
    expect(escConfirmStop(1_000, "session:one", "session:one", 1_000)).toBe(true)
  })

  test("an arm cannot cross from evaluation into the conversation turn", () => {
    expect(escConfirmStop(1_000, "evaluation:one", "session:one", 1_001)).toBe(false)
  })

  test("stale arms expire (lone Esc never kills)", () => {
    expect(escConfirmStop(1_000, "session:one", "session:one", 1_000 + ESC_ARM_WINDOW_MS)).toBe(false)
    expect(escConfirmStop(1_000, "session:one", "session:one", 1_000 + ESC_ARM_WINDOW_MS + 5_000)).toBe(false)
  })
})
