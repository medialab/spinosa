import { describe, expect, test } from "bun:test"
import {
  acquireOutboundPump,
  admittedUserIDFromResponse,
  clearOutbound,
  dispatchPositions,
  enqueueOutbound,
  failedOutboundForSession,
  findEchoByPromptID,
  findOutboundEcho,
  hasServerEcho,
  interruptedOutboundForSession,
  isOutboundPumping,
  kickPump,
  liveOutboundForSession,
  markOutboundFailed,
  markOutboundInterrupted,
  markOutboundSent,
  markOutboundStale,
  mergeTranscriptRows,
  internTranscriptRows,
  transcriptRowKey,
  outboundEntryState,
  outboundForSession,
  peekDispatchable,
  peekOutbound,
  registerPump,
  releaseOutboundPump,
  removeOutbound,
  ownsOutboundPump,
  shouldRestoreCancelledText,
  SPINOSA_PROMPT_METADATA,
  steerOutbound,
  unregisterPump,
  waitForEcho,
  invalidateOutboundPump,
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

  test("markOutboundSent flips only a queued or steered head", () => {
    const sid = "ses-queue-sent-head"
    const first = enqueueOutbound(sid, snapshot("one"), dispatch())
    const second = enqueueOutbound(sid, snapshot("two"), dispatch())
    expect(markOutboundSent(sid, second)).toBe(false)
    expect(markOutboundSent(sid, first)).toBe(true)
    expect(peekOutbound(sid)?.state).toBe("sent")
    expect(peekDispatchable(sid)?.key).toBe(second)
    clearOutbound(sid)
  })

  test("remove drops entries", () => {
    const sid = "ses-queue-remove"
    const key = enqueueOutbound(sid, snapshot("one"), dispatch())
    removeOutbound(sid, key)
    expect(peekOutbound(sid)).toBeUndefined()
    clearOutbound(sid)
  })

  test("pump flags are single-flight", () => {
    const sid = "ses-queue-pump"
    expect(isOutboundPumping(sid)).toBe(false)
    const first = acquireOutboundPump(sid)
    expect(first).toBeNumber()
    expect(isOutboundPumping(sid)).toBe(true)
    expect(acquireOutboundPump(sid)).toBeUndefined()
    expect(releaseOutboundPump(sid, first!)).toBe(true)
    expect(isOutboundPumping(sid)).toBe(false)
  })

  test("invalidating a stuck pump lets a replacement owner take over", () => {
    const sid = "ses-queue-pump-cancel"
    const staleLease = acquireOutboundPump(sid)
    expect(staleLease).toBeNumber()
    expect(invalidateOutboundPump(sid)).toBe(true)
    expect(isOutboundPumping(sid)).toBe(false)

    const replacement = acquireOutboundPump(sid)
    expect(replacement).toBeNumber()
    expect(ownsOutboundPump(sid, replacement!)).toBe(true)
    expect(releaseOutboundPump(sid, staleLease!)).toBe(false)
    expect(ownsOutboundPump(sid, replacement!)).toBe(true)
    expect(releaseOutboundPump(sid, replacement!)).toBe(true)
  })

  test("sessions are isolated", () => {
    enqueueOutbound("ses-queue-a", snapshot("a"), dispatch())
    enqueueOutbound("ses-queue-b", snapshot("b"), dispatch())
    expect(peekOutbound("ses-queue-a")?.text).toBe("a")
    expect(peekOutbound("ses-queue-b")?.text).toBe("b")
    clearOutbound("ses-queue-a")
    clearOutbound("ses-queue-b")
  })

  test("steer keeps render order and dispatches the steered entry next", () => {
    const sid = "ses-queue-steer"
    enqueueOutbound(sid, snapshot("a"), dispatch())
    const b = enqueueOutbound(sid, snapshot("b"), dispatch())
    enqueueOutbound(sid, snapshot("c"), dispatch())
    expect(steerOutbound(sid, b)).toBe(true)
    // Position frozen: insertion order stays, only status flips.
    expect(outboundForSession(sid).map((e) => e.text)).toEqual(["a", "b", "c"])
    expect(outboundForSession(sid)[1]?.state).toBe("steered")
    expect(peekDispatchable(sid)?.key).toBe(b)
    expect(dispatchPositions(sid).get(b)).toBe(1)
    expect(steerOutbound(sid, b)).toBe(false)
    expect(steerOutbound(sid, "missing")).toBe(false)
    clearOutbound(sid)
  })

  test("first-steered wins when several are steered", () => {
    const sid = "ses-queue-steer-first"
    const a = enqueueOutbound(sid, snapshot("a"), dispatch())
    const b = enqueueOutbound(sid, snapshot("b"), dispatch())
    const c = enqueueOutbound(sid, snapshot("c"), dispatch())
    expect(steerOutbound(sid, c)).toBe(true)
    expect(steerOutbound(sid, a)).toBe(true)
    // c steered first, so c dispatches first even though a sits above it.
    expect(peekDispatchable(sid)?.key).toBe(c)
    expect(dispatchPositions(sid).get(c)).toBe(1)
    expect(dispatchPositions(sid).get(a)).toBe(2)
    // Unsteered b trails both, render order untouched.
    expect(dispatchPositions(sid).get(b)).toBe(3)
    expect(outboundForSession(sid).map((e) => e.key)).toEqual([a, b, c])
    clearOutbound(sid)
  })

  test("steer third then interrupt keeps remaining prompts dispatchable", () => {
    const sid = "ses-queue-steer-interrupt"
    const first = enqueueOutbound(sid, snapshot("first"), dispatch())
    const second = enqueueOutbound(sid, snapshot("second"), dispatch())
    const third = enqueueOutbound(sid, snapshot("third"), dispatch())
    expect(steerOutbound(sid, third)).toBe(true)
    expect(markOutboundInterrupted(sid, first)).toBe(true)
    expect(peekDispatchable(sid)?.key).toBe(third)
    expect(markOutboundInterrupted(sid, third)).toBe(true)
    const fourth = enqueueOutbound(sid, snapshot("fourth"), dispatch())
    expect(outboundForSession(sid).map((entry) => [entry.key, entry.state])).toEqual([
      [first, "interrupted"],
      [second, "queued"],
      [third, "interrupted"],
      [fourth, "queued"],
    ])
    expect(peekDispatchable(sid)?.key).toBe(second)
    clearOutbound(sid)
  })

  test("eviction never drops live entries and caps interrupted receipts", () => {
    const sid = "ses-queue-evict"
    for (let i = 0; i < 25; i++) {
      const key = enqueueOutbound(sid, snapshot(`old-${i}`), dispatch())
      expect(markOutboundInterrupted(sid, key)).toBe(true)
    }
    expect(interruptedOutboundForSession(sid)).toHaveLength(20)
    const live = enqueueOutbound(sid, snapshot("live"), dispatch())
    expect(liveOutboundForSession(sid).map((e) => e.key)).toEqual([live])
    expect(peekDispatchable(sid)?.key).toBe(live)
    clearOutbound(sid)
  })

  test("stress queue keeps every live entry", () => {
    const sid = "ses-queue-stress"
    const keys: string[] = []
    for (let i = 0; i < 55; i++) keys.push(enqueueOutbound(sid, snapshot(`m-${i}`), dispatch()))
    expect(outboundForSession(sid)).toHaveLength(55)
    expect(peekDispatchable(sid)?.key).toBe(keys[0])
    clearOutbound(sid)
  })

  test("sent rows leave the dispatch order but stay visible", () => {
    const sid = "ses-queue-sent"
    const first = enqueueOutbound(sid, snapshot("one"), dispatch())
    const second = enqueueOutbound(sid, snapshot("two"), dispatch())
    expect(markOutboundSent(sid, second)).toBe(false)
    expect(markOutboundSent(sid, first)).toBe(true)
    expect(markOutboundSent(sid, second)).toBe(true)
    expect(peekDispatchable(sid)).toBeUndefined()
    expect(dispatchPositions(sid).has(first)).toBe(false)
    expect(liveOutboundForSession(sid).map((e) => e.key)).toEqual([first, second])
    clearOutbound(sid)
  })

  test("interrupted queued prompts remain visible without blocking the next prompt", () => {
    const sid = "ses-queue-interrupted"
    const first = enqueueOutbound(sid, snapshot("one"), dispatch())
    const second = enqueueOutbound(sid, snapshot("two"), dispatch())
    expect(markOutboundInterrupted(sid, first)).toBe(true)
    expect(outboundForSession(sid).find((entry) => entry.key === first)?.state).toBe("interrupted")
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
    expect(markOutboundInterrupted(sid, first)).toBe(true)
    expect(liveOutboundForSession(sid).map((e) => e.key)).toEqual([second])
    expect(interruptedOutboundForSession(sid).map((e) => e.key)).toEqual([first])
    clearOutbound(sid)
  })
})

describe("mergeTranscriptRows", () => {
  const outboundEntry = (
    key: string,
    createdAt: number,
    state: OutboundEntry["state"] = "interrupted",
    text = key,
  ): OutboundEntry => ({
    key,
    sessionID: "ses-merge",
    text,
    snapshot: snapshot(key),
    dispatch: dispatch(),
    createdAt,
    state,
  })

  const rowIDs = (rows: ReturnType<typeof mergeTranscriptRows>) =>
    rows.map((row) => (row.kind === "message" ? row.message.id : row.entry.key))

  test("places outbound rows chronologically among server messages", () => {
    const messages = [
      { id: "m1", time: { created: 100 } },
      { id: "m2", time: { created: 300 } },
    ]
    const rows = mergeTranscriptRows(messages, [outboundEntry("out-1", 200)])
    expect(rowIDs(rows)).toEqual(["m1", "out-1", "m2"])
    expect(rows[0]).toMatchObject({ kind: "message", messageIndex: 0 })
    expect(rows[2]).toMatchObject({ kind: "message", messageIndex: 1 })
  })

  test("ties keep server order first so rows trail clock-equal messages", () => {
    const messages = [{ id: "m1", time: { created: 200 } }]
    const rows = mergeTranscriptRows(messages, [outboundEntry("out-1", 200)])
    expect(rowIDs(rows)).toEqual(["m1", "out-1"])
  })

  test("interns unchanged row objects across rebuilds", () => {
    const messages = [
      { id: "m1", time: { created: 100 } },
      { id: "m2", time: { created: 300 } },
    ]
    const first = mergeTranscriptRows(messages, [outboundEntry("out-1", 200)])
    const second = internTranscriptRows(first, mergeTranscriptRows(messages, [outboundEntry("out-1", 200)]))
    expect(second[0]).toBe(first[0])
    expect(second[2]).toBe(first[2])
    expect(transcriptRowKey(first[0]!)).toBe("message:m1")
  })

  test("live and settled rows share one chronological list", () => {
    const messages = [
      { id: "m1", time: { created: 100 } },
      { id: "m2", time: { created: 400 } },
    ]
    const rows = mergeTranscriptRows(messages, [
      outboundEntry("old-interrupted", 50, "interrupted"),
      outboundEntry("live-queued", 150, "queued"),
      outboundEntry("live-sent", 250, "sent"),
      outboundEntry("new-failed", 350, "failed"),
    ])
    expect(rowIDs(rows)).toEqual(["old-interrupted", "m1", "live-queued", "live-sent", "new-failed", "m2"])
  })

  test("drops Sent once the General prompt echo is already in the transcript", () => {
    const messages = [{ id: "m1", role: "user" as const, time: { created: 300 } }]
    const parts = {
      m1: [{ type: "text", text: "call each of them", metadata: { [SPINOSA_PROMPT_METADATA]: "out-1" } }],
    }
    const rows = mergeTranscriptRows(
      messages,
      [outboundEntry("out-1", 200, "sent", "call each of them")],
      parts,
    )
    expect(rowIDs(rows)).toEqual(["m1"])
  })

  test("drops Sent when the echo lost the prompt stamp but kept the same text", () => {
    const messages = [{ id: "m1", role: "user" as const, time: { created: 300 } }]
    const parts = {
      m1: [{ type: "text", text: "call each of them" }],
    }
    const rows = mergeTranscriptRows(
      messages,
      [outboundEntry("out-1", 200, "sent", "call each of them")],
      parts,
    )
    expect(rowIDs(rows)).toEqual(["m1"])
  })

  test("keeps queued rows even when a historical user row has the same text", () => {
    const messages = [{ id: "m1", role: "user" as const, time: { created: 100 } }]
    const parts = { m1: [{ type: "text", text: "call each of them" }] }
    const rows = mergeTranscriptRows(
      messages,
      [outboundEntry("out-2", 200, "queued", "call each of them")],
      parts,
    )
    expect(rowIDs(rows)).toEqual(["m1", "out-2"])
  })

  test("pairs two identical texts onto two user rows", () => {
    const messages = [
      { id: "m1", role: "user" as const, time: { created: 100 } },
      { id: "m2", role: "user" as const, time: { created: 300 } },
    ]
    const parts = {
      m1: [{ type: "text", text: "call each of them" }],
      m2: [{ type: "text", text: "call each of them" }],
    }
    const rows = mergeTranscriptRows(
      messages,
      [
        outboundEntry("out-1", 50, "sent", "call each of them"),
        outboundEntry("out-2", 250, "sent", "call each of them"),
      ],
      parts,
    )
    expect(rowIDs(rows)).toEqual(["m1", "m2"])
  })
})

describe("prompt id echo correlation", () => {
  test("finds the echo carrying the stamped prompt id", () => {
    const messages = [{ id: "m1" }, { id: "m2" }]
    const parts = {
      m1: [{ type: "text", text: "other" }],
      m2: [{ type: "text", text: "mine", metadata: { [SPINOSA_PROMPT_METADATA]: "outbound-1" } }],
    }
    expect(findEchoByPromptID(messages, parts, "outbound-1")).toBe("m2")
    expect(findEchoByPromptID(messages, parts, "missing")).toBeUndefined()
    expect(findEchoByPromptID([], {}, "outbound-1")).toBeUndefined()
  })

  test("matches an unstamped user echo by text so Sent can retire", () => {
    const messages = [
      { id: "m1", role: "user" },
      { id: "m2", role: "assistant" },
    ]
    const parts = {
      m1: [{ type: "text", text: "call each of them" }],
      m2: [{ type: "text", text: "call each of them" }],
    }
    expect(
      findOutboundEcho(messages, parts, { key: "out-1", text: "call each of them" }),
    ).toBe("m1")
  })

  test("does not steal a user row stamped for another prompt", () => {
    const messages = [{ id: "m1", role: "user" }]
    const parts = {
      m1: [{ type: "text", text: "call each of them", metadata: { [SPINOSA_PROMPT_METADATA]: "out-other" } }],
    }
    expect(
      findOutboundEcho(messages, parts, { key: "out-1", text: "call each of them" }),
    ).toBeUndefined()
  })
})

describe("failed and stale receipts", () => {
  test("failed rows rest in place with their text", () => {
    const sid = "ses-queue-failed"
    const key = enqueueOutbound(sid, snapshot("doomed"), dispatch())
    expect(markOutboundFailed(sid, key)).toBe(true)
    expect(outboundEntryState(sid, key)).toBe("failed")
    expect(failedOutboundForSession(sid).map((e) => e.text)).toEqual(["doomed"])
    // Failed receipts never block the queue and survive in the merged list.
    expect(peekDispatchable(sid)).toBeUndefined()
    const rows = mergeTranscriptRows([], outboundForSession(sid))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: "outbound" })
    clearOutbound(sid)
  })

  test("stale marks sent-but-blocked rows without deleting them", () => {
    const sid = "ses-queue-stale"
    const key = enqueueOutbound(sid, snapshot("blocked"), dispatch())
    expect(markOutboundSent(sid, key)).toBe(true)
    expect(markOutboundStale(sid, key)).toBe(true)
    expect(outboundEntryState(sid, key)).toBe("sent")
    expect(outboundForSession(sid).find((e) => e.key === key)?.stale).toBe(true)
    // Stale is sent-only: receipts ignore it.
    expect(markOutboundStale(sid, "missing")).toBe(false)
    clearOutbound(sid)
  })

  test("failed receipts roll off past the cap, live rows never move", () => {
    const sid = "ses-queue-failed-cap"
    for (let i = 0; i < 25; i++) {
      const key = enqueueOutbound(sid, snapshot(`f-${i}`), dispatch())
      expect(markOutboundFailed(sid, key)).toBe(true)
    }
    expect(failedOutboundForSession(sid)).toHaveLength(20)
    const live = enqueueOutbound(sid, snapshot("live"), dispatch())
    expect(peekDispatchable(sid)?.key).toBe(live)
    clearOutbound(sid)
  })
})

describe("echo handoff", () => {
  test("extracts the admitted id from every response shape", () => {
    // V2 durable admission.
    expect(admittedUserIDFromResponse({ data: { id: "msg-1", sessionID: "s" } })).toBe("msg-1")
    // V1 / command envelope (assistant shell carries the user parent).
    expect(admittedUserIDFromResponse({ data: { info: { parentID: "msg-2" } } })).toBe("msg-2")
    // Bare shell response.
    expect(admittedUserIDFromResponse({ info: { parentID: "msg-3" } })).toBe("msg-3")
    // Bare assistant message: user parent wins over the assistant's own id.
    expect(admittedUserIDFromResponse({ id: "assistant-1", parentID: "user-1" })).toBe("user-1")
    expect(admittedUserIDFromResponse(undefined)).toBeUndefined()
    expect(admittedUserIDFromResponse({ data: null })).toBeUndefined()
    expect(admittedUserIDFromResponse({ data: { info: {} } })).toBeUndefined()
    expect(admittedUserIDFromResponse({ data: { id: "" } })).toBeUndefined()
  })

  test("matches echoes by id", () => {
    const messages = [{ id: "m1" }, { id: "m2" }]
    expect(hasServerEcho(messages, "m2")).toBe(true)
    expect(hasServerEcho(messages, "missing")).toBe(false)
    expect(hasServerEcho([], "m1")).toBe(false)
  })

  test("waitForEcho resolves true once present, false on timeout", async () => {
    expect(await waitForEcho(() => true, 100, 10)).toBe(true)
    let flips = 0
    const late = () => {
      flips += 1
      return flips >= 3
    }
    expect(await waitForEcho(late, 500, 10)).toBe(true)
    expect(await waitForEcho(() => false, 50, 10)).toBe(false)
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
