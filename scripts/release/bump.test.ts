import { describe, expect, test } from "bun:test"
import { planBump, planRelease } from "./bump.ts"

describe("release bump planning", () => {
  test("increments beta prerelease on patch", () => {
    expect(planBump("1.0.3-beta.0", "beta", "patch")).toBe("1.0.3-beta.1")
  })

  test("starts beta series from stable patch", () => {
    expect(planBump("1.0.3", "beta", "patch")).toBe("1.0.4-beta.0")
  })

  test("increments beta minor series", () => {
    expect(planBump("1.0.3-beta.4", "beta", "minor")).toBe("1.1.0-beta.0")
  })

  test("increments stable patch", () => {
    expect(planBump("1.0.3", "stable", "patch")).toBe("1.0.4")
  })

  test("plans a full release from package.json", () => {
    const plan = planRelease("beta", "patch")
    expect(plan.next).toBe(planBump(plan.current, "beta", "patch"))
    expect(plan.tag).toBe(`v${plan.next}`)
  })
})
