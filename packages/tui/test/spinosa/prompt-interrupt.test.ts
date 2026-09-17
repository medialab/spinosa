import { describe, expect, test } from "bun:test"
import { escConfirmStop, ESC_ARM_WINDOW_MS } from "../../src/component/prompt/interrupt"

describe("escConfirmStop", () => {
  const target = "session:ses-1"
  const now = 1_000_000

  test("unarmed never confirms", () => {
    expect(escConfirmStop(0, undefined, target, now)).toBe(false)
    expect(escConfirmStop(undefined, undefined, target, now)).toBe(false)
  })

  test("second press on the same target within the window confirms", () => {
    expect(escConfirmStop(now - 1000, target, target, now)).toBe(true)
  })

  test("expired arm does not confirm", () => {
    expect(escConfirmStop(now - ESC_ARM_WINDOW_MS - 1, target, target, now)).toBe(false)
  })

  test("arm bound to another target does not confirm", () => {
    // The arm is target-bound so an Esc pressed during routing cannot later
    // kill an unrelated chat turn.
    expect(escConfirmStop(now - 100, "session:ses-other", target, now)).toBe(false)
    expect(escConfirmStop(now - 100, "session:ses-2", target, now)).toBe(false)
  })
})
