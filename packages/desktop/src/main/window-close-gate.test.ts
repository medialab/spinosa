import { describe, expect, test } from "bun:test"
import { createWindowCloseGate } from "./window-close-gate"

describe("window close gate", () => {
  test("deduplicates close requests and retries after cancellation", async () => {
    let requests = 0
    const gate = createWindowCloseGate(() => { requests += 1 })
    const first = gate.request()
    const duplicate = gate.request()
    expect(requests).toBe(1)
    expect(first).toBe(duplicate)
    gate.respond(false)
    expect(await first).toBe(false)

    const next = gate.request()
    expect(requests).toBe(2)
    gate.respond(true)
    expect(await next).toBe(true)
  })

  test("ignores replies without a pending close", () => {
    const gate = createWindowCloseGate(() => {})
    expect(gate.respond(true)).toBe(false)
  })

  test("fails closed when the renderer cannot receive a close request", async () => {
    const gate = createWindowCloseGate(() => { throw new Error("renderer gone") })
    expect(await gate.request()).toBe(false)
    expect(gate.respond(true)).toBe(false)
  })
})
