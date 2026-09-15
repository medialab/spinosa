import { createStore, produce } from "solid-js/store"
import type { PromptInfo } from "../prompt/history"

/**
 * TUI-local outbound queue for Spinosa workspace prompts.
 *
 * Enter admits a message here FIRST (visible instantly as an optimistic
 * transcript row), and a per-session dispatcher evaluates + sends entries
 * strictly FIFO when the session is idle:
 *
 *   queued ──steer──→ steered
 *      └──────────────┴──→ evaluating → sent (server echo takes over)
 *                                  ↘ interrupted (row remains as a receipt)
 *
 * Nothing here touches the server: no protocol change, no durable state.
 * Server admission still happens exactly once per prompt, at dispatch time,
 * through the existing direct/workflow send paths.
 */

export type OutboundState = "queued" | "steered" | "evaluating" | "interrupted"

/**
 * Everything the dispatcher needs to send the prompt exactly as submit
 * captured it. Agent/model/variant/directory resolve fresh at dispatch —
 * the queue may hold an entry across a model switch.
 */
export type OutboundSnapshot = {
  text: string
  nonTextParts: PromptInfo["parts"]
  editorParts: PromptInfo["parts"]
}

/**
 * Submit-time send context, snapshotted at Enter so a queued entry sends
 * exactly what the user submitted even if agent/model/dir change mid-queue.
 */
export type DispatchContext = {
  agentName: string
  model: { providerID: string; modelID: string }
  variant: string | undefined
  sessionDirectory: string | undefined
  forceAgent: string | undefined
  mode: "normal" | "shell"
  preferQueue?: boolean
  preferSteer?: boolean
}

export type OutboundEntry = {
  /** Unique per enqueue (never a server id — the server row arrives later). */
  key: string
  sessionID: string
  text: string
  snapshot: OutboundSnapshot
  dispatch: DispatchContext
  createdAt: number
  state: OutboundState
}

let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `outbound-${Date.now().toString(36)}-${keyCounter}`
}

/** Bounded: entries are removed at send time; the cap only guards leaks. */
const MAX_TRACKED_ENTRIES = 50

const [entriesBySession, setEntriesBySession] = createStore<Record<string, OutboundEntry[]>>({})

/** AbortControllers for in-flight evaluations (side map — not reactive state). */
const controllers = new Map<string, AbortController>()

/** Single-flight dispatcher flags per session. */
const pumping = new Set<string>()

export function enqueueOutbound(
  sessionID: string,
  snapshot: OutboundSnapshot,
  dispatch: DispatchContext,
): string {
  const key = nextKey()
  const entry: OutboundEntry = {
    key, sessionID, text: snapshot.text, snapshot, dispatch, createdAt: Date.now(), state: "queued",
  }
  setEntriesBySession(
    produce((draft) => {
      const list = draft[sessionID] ?? (draft[sessionID] = [])
      list.push(entry)
      while (list.length > MAX_TRACKED_ENTRIES) list.shift()
    }),
  )
  return key
}

/** Oldest dispatchable entry. Interrupted receipts never block the queue. */
export function peekOutbound(sessionID: string): OutboundEntry | undefined {
  return entriesBySession[sessionID]?.find((entry) => entry.state !== "interrupted")
}

/** Reactive snapshot of a session's undispatched entries (rendering). */
export function outboundForSession(sessionID: string): OutboundEntry[] {
  return entriesBySession[sessionID] ?? []
}

/** Live entries that have not settled yet — always trail the transcript. */
export function liveOutboundForSession(sessionID: string): OutboundEntry[] {
  return (entriesBySession[sessionID] ?? []).filter((entry) => entry.state !== "interrupted")
}

/** Settled interrupted receipts — historical rows, rendered chronologically. */
export function interruptedOutboundForSession(sessionID: string): OutboundEntry[] {
  return (entriesBySession[sessionID] ?? [])
    .filter((entry) => entry.state === "interrupted")
    .toSorted((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export type TranscriptMessageLike = {
  id: string
  time: { created: number }
}

export type MergedTranscriptRow<T extends TranscriptMessageLike = TranscriptMessageLike> =
  | { kind: "message"; message: T; messageIndex: number }
  | { kind: "interrupted"; entry: OutboundEntry }

/**
 * Merge server messages with interrupted receipts in chronological order so
 * settled receipts scroll with the conversation instead of sticking to the
 * bottom above the prompt box. Live (queued/steered/evaluating) entries are
 * NOT included here — callers render `liveOutboundForSession` trailing.
 *
 * Messages are assumed pre-sorted; interrupted entries are sorted by
 * `createdAt` (stable by key). An interrupted entry sorts before the first
 * server message with `time.created` strictly greater than its `createdAt`,
 * so clock ties keep server order first and the receipt trails them.
 */
export function mergeTranscriptWithInterrupted<T extends TranscriptMessageLike>(
  messages: readonly T[],
  interrupted: readonly OutboundEntry[],
): MergedTranscriptRow<T>[] {
  const settled = [...interrupted].sort((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const rows: MergedTranscriptRow<T>[] = []
  let at = 0
  messages.forEach((message, messageIndex) => {
    const created = message.time.created
    while (at < settled.length && settled[at]!.createdAt < created) {
      rows.push({ kind: "interrupted", entry: settled[at]! })
      at += 1
    }
    rows.push({ kind: "message", message, messageIndex })
  })
  while (at < settled.length) {
    rows.push({ kind: "interrupted", entry: settled[at]! })
    at += 1
  }
  return rows
}

/** Flip the head entry to evaluating. False when it is gone or not the head. */
export function markOutboundEvaluating(sessionID: string, key: string): boolean {
  const head = peekOutbound(sessionID)
  if (!head || head.key !== key || (head.state !== "queued" && head.state !== "steered")) return false
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((e) => e.key === key)
      if (found) found.state = "evaluating"
    }),
  )
  return true
}

export function removeOutbound(sessionID: string, key: string): void {
  controllers.delete(key)
  setEntriesBySession(
    produce((draft) => {
      const list = draft[sessionID]
      if (!list) return
      const at = list.findIndex((e) => e.key === key)
      if (at >= 0) list.splice(at, 1)
      if (list.length === 0) delete draft[sessionID]
    }),
  )
}

export function clearOutbound(sessionID: string): void {
  for (const entry of entriesBySession[sessionID] ?? []) controllers.delete(entry.key)
  setEntriesBySession(
    produce((draft) => {
      delete draft[sessionID]
    }),
  )
}

export function hasEvaluating(sessionID: string): boolean {
  return (entriesBySession[sessionID] ?? []).some((e) => e.state === "evaluating")
}

/** Preserve a cancelled evaluation in the transcript as an explicit receipt. */
export function markOutboundInterrupted(sessionID: string, key: string): boolean {
  const entry = entriesBySession[sessionID]?.find((candidate) => candidate.key === key)
  if (!entry || entry.state !== "evaluating") return false
  controllers.delete(key)
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((candidate) => candidate.key === key)
      if (found?.state === "evaluating") found.state = "interrupted"
    }),
  )
  return true
}

/**
 * Steer: move a queued entry to the front so the pump dispatches it next.
 * FIFO order of the remaining entries is preserved. False when the entry
 * is gone or has already been steered/evaluated.
 */
export function steerOutbound(sessionID: string, key: string): boolean {
  const list = entriesBySession[sessionID]
  if (!list) return false
  const at = list.findIndex((e) => e.key === key)
  if (at < 0) return false
  if (list[at]?.state !== "queued") return false
  setEntriesBySession(
    produce((draft) => {
      const items = draft[sessionID]
      if (!items) return
      const idx = items.findIndex((e) => e.key === key)
      if (idx < 0) return
      const [entry] = items.splice(idx, 1)
      if (!entry) return
      entry.state = "steered"
      items.unshift(entry)
    }),
  )
  return true
}

/** Pump registry: the prompt component owns dispatch; other views kick it. */
const pumpHandlers = new Map<string, () => void>()

export function registerPump(sessionID: string, kick: () => void): void {
  pumpHandlers.set(sessionID, kick)
}

export function unregisterPump(sessionID: string): void {
  pumpHandlers.delete(sessionID)
}

export function kickPump(sessionID: string): void {
  try {
    pumpHandlers.get(sessionID)?.()
  } catch {
    /* pump kicks never throw into views */
  }
}

export function evaluatingKeys(sessionID: string): string[] {
  return (entriesBySession[sessionID] ?? []).filter((e) => e.state === "evaluating").map((e) => e.key)
}

export function setOutboundController(key: string, controller: AbortController): void {
  controllers.set(key, controller)
}

export function abortOutbound(key: string): void {
  controllers.get(key)?.abort()
  controllers.delete(key)
}

export function isOutboundPumping(sessionID: string): boolean {
  return pumping.has(sessionID)
}

export function setOutboundPumping(sessionID: string, active: boolean): void {
  if (active) pumping.add(sessionID)
  else pumping.delete(sessionID)
}

/**
 * Esc-cancel ruling: restore the cancelled text into the input box only
 * when the user hasn't typed anything new since — never clobber fresh input.
 */
export function shouldRestoreCancelledText(cancelledText: string, currentInput: string): boolean {
  return cancelledText.length > 0 && currentInput.trim().length === 0
}
