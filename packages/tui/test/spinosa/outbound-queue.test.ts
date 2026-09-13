import { describe, expect, test } from "bun:test"
import {
  abortOutbound,
  clearOutbound,
  enqueueOutbound,
  evaluatingKeys,
  hasEvaluating,
  isOutboundPumping,
  markOutboundEvaluating,
  outboundForSession,
  peekOutbound,
  removeOutbound,
  setOutboundController,
  setOutboundPumping,
  shouldRestoreCancelledText,
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
})

describe("shouldRestoreCancelledText", () => {
  test("restores only into an empty box", () => {
    expect(shouldRestoreCancelledText("hello", "")).toBe(true)
    expect(shouldRestoreCancelledText("hello", "   ")).toBe(true)
    expect(shouldRestoreCancelledText("hello", "new text")).toBe(false)
    expect(shouldRestoreCancelledText("", "")).toBe(false)
  })
})
