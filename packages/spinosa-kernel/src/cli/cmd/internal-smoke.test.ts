import { describe, expect, test } from "bun:test"
import { evaluateNativeImportChecks, type NativeImportCheck } from "./internal.ts"

const allOk: NativeImportCheck[] = [
  { name: "opentui", ok: true },
  { name: "fff", ok: true },
  { name: "watcher", ok: true },
  { name: "node-pty", ok: true },
  { name: "canvas", ok: true },
]

describe("internal smoke native-imports aggregation (fail closed)", () => {
  test("all five natives ok → ok payload", () => {
    const { ok, payload } = evaluateNativeImportChecks(allOk)
    expect(ok).toBe(true)
    expect(payload).toEqual({ ok: true, checks: allOk })
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
  })

  test("one corrupt native fails the whole gate", () => {
    for (const name of ["opentui", "fff", "watcher", "node-pty", "canvas"] as const) {
      const checks = allOk.map((c) => (c.name === name ? { ...c, ok: false, error: "dlopen failed" } : c))
      const { ok, payload } = evaluateNativeImportChecks(checks)
      expect(ok).toBe(false)
      expect(payload.ok).toBe(false)
      expect(payload.checks.find((c) => c.name === name)?.error).toBe("dlopen failed")
    }
  })

  test("every (not some): a single failure outweighs four passes", () => {
    const checks: NativeImportCheck[] = [
      { name: "opentui", ok: true },
      { name: "fff", ok: true },
      { name: "watcher", ok: false },
      { name: "node-pty", ok: true },
      { name: "canvas", ok: true },
    ]
    expect(evaluateNativeImportChecks(checks).ok).toBe(false)
  })

  test("empty check list never passes", () => {
    expect(evaluateNativeImportChecks([]).ok).toBe(false)
  })
})
