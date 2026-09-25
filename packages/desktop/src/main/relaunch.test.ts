import { describe, expect, test } from "bun:test"
import { absoluteAppRelaunchArgs } from "./relaunch"

describe("desktop relaunch arguments", () => {
  test("replaces the relative development entry point with the absolute app path", () => {
    expect(absoluteAppRelaunchArgs(["electron", "."], "/repo/packages/desktop")).toEqual([
      "/repo/packages/desktop",
    ])
  })

  test("preserves arguments after the app entry point", () => {
    expect(
      absoluteAppRelaunchArgs(["electron", ".", "--remote-debugging-port=9222"], "/repo/packages/desktop"),
    ).toEqual(["/repo/packages/desktop", "--remote-debugging-port=9222"])
  })
})
