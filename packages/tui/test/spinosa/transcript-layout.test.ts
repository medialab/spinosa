import { describe, expect, test } from "bun:test"
import { transcriptBudget } from "../../src/util/layout"

describe("transcriptBudget", () => {
  test("narrow terminals stay classic with full width", () => {
    expect(transcriptBudget(80)).toMatchObject({ mode: "classic", contentWidth: 76 })
    expect(transcriptBudget(85)).toMatchObject({ mode: "classic", contentWidth: 81 })
  })

  test("the old 85→86 collapse is gone", () => {
    // Old formula flipped to callout at 86 with a 54-cell center (a ~23
    // column loss for one added column). Rails now wait for a real budget.
    expect(transcriptBudget(86).mode).toBe("classic")
    expect(transcriptBudget(100).mode).toBe("classic")
    expect(transcriptBudget(100).contentWidth).toBe(96)
  })

  test("rails enable at 124 with minimums intact", () => {
    const budget = transcriptBudget(124)
    expect(budget.mode).toBe("callout")
    if (budget.mode !== "callout") return
    expect(budget.contentWidth).toBeGreaterThanOrEqual(80)
    expect(budget.railWidth).toBeGreaterThanOrEqual(18)
  })

  test("wide terminals keep the established callout geometry", () => {
    const budget = transcriptBudget(160)
    expect(budget).toMatchObject({ mode: "callout", contentWidth: 104, railWidth: 24, gap: 2 })
  })

  test("exactly one classic→callout transition and invariants hold", () => {
    let flips = 0
    let last: string | undefined
    for (let width = 40; width <= 400; width++) {
      const budget = transcriptBudget(width)
      if (budget.mode !== last) {
        if (last !== undefined) flips += 1
        last = budget.mode
      }
      if (budget.mode === "classic") {
        expect(budget.contentWidth).toBe(width - 4)
      } else {
        expect(budget.contentWidth).toBeGreaterThanOrEqual(80)
        expect(budget.railWidth).toBeGreaterThanOrEqual(18)
      }
    }
    expect(flips).toBe(1)
  })
})
