import { describe, expect, test } from "bun:test"
import {
  abortOutbound,
  clearOutbound,
  enqueueOutbound,
  evaluatingKeys,
  hasEvaluating,
  isOutboundPumping,
  kickPump,
  markOutboundEvaluating,
  outboundForSession,
  peekOutbound,
  registerPump,
  removeOutbound,
  setOutboundController,
  setOutboundPumping,
  shouldRestoreCancelledText,
  steerOutbound,
  unregisterPump,
  type DispatchContext,
  type OutboundSnapshot,
} from "../../src/spinosa/outbound-queue"

const snapshot = (text: string): OutboundSnapshot => ({ text, nonTextParts: [], editorParts: [] })
const dispatch = (): DispatchContext => ({
  agentName: "build",
  model: { providerID: "p", modelID: "m" },
  variant: undefined,
  sessionDirectory: "/tmp/ws",
  forceAgent: undefined,
  mode: "normal",
})

describe("outbound queue", () => {
  test("enqueues FIFO and peeks the head", () => {
    const sid = "ses-queue-fifo"
    const first = enqueueOutbound(sid, snapshot("one"), dispatch())
    enqueueOutbound(sid, snapshot("two"), dispatch())
    expect(peekOutbound(sid)?.key).toBe(first)
    expect(outboundForSession(sid).map((e) => e.text)).toEqual(["one", "two"])
    expect(outboundForSession(sid).every((e) => e.state === "queued")).toBe(true)
    clearOutbound(sid)
    expect(peekOutbound(sid)).toBeUndefined()
  })

  test("markEvaluating flips only the head", () => {
    const sid = "ses-queue-eval"
    const first = enqueueOutbound(sid, snapshot("one"), dispatch())
    const second = enqueueOutbound(sid, snapshot("two"), dispatch())
    expect(markOutboundEvaluating(sid, second)).toBe(false)
    expect(markOutboundEvaluating(sid, first)).toBe(true)
    expect(hasEvaluating(sid)).toBe(true)
    expect(evaluatingKeys(sid)).toEqual([first])
    expect(peekOutbound(sid)?.state).toBe("evaluating")
    clearOutbound(sid)
  })

  test("remove drops entries and controllers", () => {
    const sid = "ses-queue-remove"
    const key = enqueueOutbound(sid, snapshot("one"), dispatch())
    setOutboundController(key, new AbortController())
    removeOutbound(sid, key)
    expect(peekOutbound(sid)).toBeUndefined()
    expect(hasEvaluating(sid)).toBe(false)
  })

  test("pump flags are single-flight", () => {
    const sid = "ses-queue-pump"
    expect(isOutboundPumping(sid)).toBe(false)
    setOutboundPumping(sid, true)
    expect(isOutboundPumping(sid)).toBe(true)
    setOutboundPumping(sid, false)
    expect(isOutboundPumping(sid)).toBe(false)
  })

  test("abortOutbound fires the entry controller", () => {
    const sid = "ses-queue-abort"
    const key = enqueueOutbound(sid, snapshot("one"), dispatch())
    const controller = new AbortController()
    setOutboundController(key, controller)
    abortOutbound(key)
    expect(controller.signal.aborted).toBe(true)
    clearOutbound(sid)
  })

  test("sessions are isolated", () => {
    enqueueOutbound("ses-queue-a", snapshot("a"), dispatch())
    enqueueOutbound("ses-queue-b", snapshot("b"), dispatch())
    expect(peekOutbound("ses-queue-a")?.text).toBe("a")
    expect(peekOutbound("ses-queue-b")?.text).toBe("b")
    clearOutbound("ses-queue-a")
    clearOutbound("ses-queue-b")
  })

  test("steer moves a queued entry to the front, preserving the rest", () => {
    const sid = "ses-queue-steer"
    enqueueOutbound(sid, snapshot("a"), dispatch())
    const b = enqueueOutbound(sid, snapshot("b"), dispatch())
    enqueueOutbound(sid, snapshot("c"), dispatch())
    expect(steerOutbound(sid, b)).toBe(true)
    expect(outboundForSession(sid).map((e) => e.text)).toEqual(["b", "a", "c"])
    // Steering the head or an unknown key is a no-op success/failure pair.
    const head = peekOutbound(sid)?.key ?? ""
    expect(steerOutbound(sid, head)).toBe(true)
    expect(steerOutbound(sid, "missing")).toBe(false)
    clearOutbound(sid)
  })

  test("pump registry kicks the registered session pump", () => {
    const sid = "ses-queue-kick"
    let kicks = 0
    registerPump(sid, () => {
      kicks += 1
    })
    kickPump(sid)
    expect(kicks).toBe(1)
    unregisterPump(sid)
    kickPump(sid)
    expect(kicks).toBe(1)
  })
})

describe("shouldRestoreCancelledText", () => {
  test("restores only into an empty box", () => {
    expect(shouldRestoreCancelledText("hello", "")).toBe(true)
    expect(shouldRestoreCancelledText("hello", "   ")).toBe(true)
    expect(shouldRestoreCancelledText("hello", "new text")).toBe(false)
    expect(shouldRestoreCancelledText("", "")).toBe(false)
  })
})
