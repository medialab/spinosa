import { describe, expect, test } from "bun:test"
import {
  abortOutbound,
  clearOutbound,
  enqueueOutbound,
  evaluatingKeys,
  hasEvaluating,
  interruptedOutboundForSession,
  isOutboundPumping,
  kickPump,
  liveOutboundForSession,
  markOutboundEvaluating,
  markOutboundInterrupted,
  mergeTranscriptWithInterrupted,
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
  type OutboundEntry,
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

  test("steer is a one-way state transition and preserves the remaining queue", () => {
    const sid = "ses-queue-steer"
    enqueueOutbound(sid, snapshot("a"), dispatch())
    const b = enqueueOutbound(sid, snapshot("b"), dispatch())
    enqueueOutbound(sid, snapshot("c"), dispatch())
    expect(steerOutbound(sid, b)).toBe(true)
    expect(outboundForSession(sid).map((e) => e.text)).toEqual(["b", "a", "c"])
    expect(outboundForSession(sid)[0]?.state).toBe("steered")
    expect(steerOutbound(sid, b)).toBe(false)
    expect(steerOutbound(sid, "missing")).toBe(false)
    clearOutbound(sid)
  })

  test("interrupted evaluations remain visible without blocking the next prompt", () => {
    const sid = "ses-queue-interrupted"
    const first = enqueueOutbound(sid, snapshot("one"), dispatch())
    const second = enqueueOutbound(sid, snapshot("two"), dispatch())
    expect(markOutboundEvaluating(sid, first)).toBe(true)
    expect(markOutboundInterrupted(sid, first)).toBe(true)
    expect(outboundForSession(sid).find((entry) => entry.key === first)?.state).toBe("interrupted")
    expect(hasEvaluating(sid)).toBe(false)
    expect(peekOutbound(sid)?.key).toBe(second)
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

  test("live split keeps interrupted out of the trailing queue", () => {
    const sid = "ses-queue-split"
    const first = enqueueOutbound(sid, snapshot("one"), dispatch())
    const second = enqueueOutbound(sid, snapshot("two"), dispatch())
    expect(markOutboundEvaluating(sid, first)).toBe(true)
    expect(markOutboundInterrupted(sid, first)).toBe(true)
    expect(liveOutboundForSession(sid).map((e) => e.key)).toEqual([second])
    expect(interruptedOutboundForSession(sid).map((e) => e.key)).toEqual([first])
    clearOutbound(sid)
  })
})

describe("mergeTranscriptWithInterrupted", () => {
  const interruptedEntry = (key: string, createdAt: number): OutboundEntry => ({
    key,
    sessionID: "ses-merge",
    text: key,
    snapshot: snapshot(key),
    dispatch: dispatch(),
    createdAt,
    state: "interrupted",
  })

  test("places an interrupted receipt chronologically instead of trailing", () => {
    const messages = [
      { id: "m1", time: { created: 100 } },
      { id: "m2", time: { created: 300 } },
    ]
    const rows = mergeTranscriptWithInterrupted(messages, [interruptedEntry("out-1", 200)])
    expect(rows.map((row) => (row.kind === "message" ? row.message.id : row.entry.key))).toEqual([
      "m1",
      "out-1",
      "m2",
    ])
    expect(rows[0]).toMatchObject({ kind: "message", messageIndex: 0 })
    expect(rows[2]).toMatchObject({ kind: "message", messageIndex: 1 })
  })

  test("ties keep server order first so receipts trail clock-equal messages", () => {
    const messages = [{ id: "m1", time: { created: 200 } }]
    const rows = mergeTranscriptWithInterrupted(messages, [interruptedEntry("out-1", 200)])
    expect(rows.map((row) => (row.kind === "message" ? row.message.id : row.entry.key))).toEqual([
      "m1",
      "out-1",
    ])
  })

  test("later server messages sort after an older interrupted receipt", () => {
    const messages = [
      { id: "m1", time: { created: 100 } },
      { id: "m2", time: { created: 200 } },
    ]
    const rows = mergeTranscriptWithInterrupted(messages, [interruptedEntry("out-1", 50)])
    expect(rows[0]).toMatchObject({ kind: "interrupted" })
    expect(rows.map((row) => (row.kind === "message" ? row.message.id : row.entry.key))).toEqual([
      "out-1",
      "m1",
      "m2",
    ])
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
