import { describe, expect, test } from "bun:test"
import { registerTuiExitHook, runTuiExitHooks } from "../../src/util/tui-exit-hooks"

describe("tui exit hooks", () => {
  test("runs registered hooks once on exit", async () => {
    const calls: string[] = []
    const off = registerTuiExitHook(async () => {
      calls.push("stop")
    })
    await runTuiExitHooks()
    expect(calls).toEqual(["stop"])
    await runTuiExitHooks()
    expect(calls).toEqual(["stop"])
    off()
  })

  test("swallows hook failures so exit still proceeds", async () => {
    registerTuiExitHook(async () => {
      throw new Error("abort failed")
    })
    await runTuiExitHooks()
  })
})
