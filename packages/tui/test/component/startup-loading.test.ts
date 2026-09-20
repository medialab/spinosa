import { describe, expect, test } from "bun:test"
import { nextStartupOverlayAction } from "../../src/component/startup-loading"

describe("nextStartupOverlayAction", () => {
  test("completes immediately when boot is already ready and the splash never showed", () => {
    expect(
      nextStartupOverlayAction({ ready: true, showing: false, bootInProgress: false }),
    ).toBe("complete")
  })

  test("holds the minimum splash only after the overlay is visible", () => {
    expect(
      nextStartupOverlayAction({ ready: true, showing: true, bootInProgress: false }),
    ).toBe("hold")
  })

  test("tracks boot work before first paint", () => {
    expect(
      nextStartupOverlayAction({ ready: false, showing: false, bootInProgress: true }),
    ).toBe("track-boot")
  })

  test("defers the splash until plugins or boot actually take time", () => {
    expect(
      nextStartupOverlayAction({ ready: false, showing: false, bootInProgress: false }),
    ).toBe("defer-show")
  })
})
