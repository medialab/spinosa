import { createStore, produce } from "solid-js/store"
import type { PromptInfo } from "../prompt/history"

/**
 * TUI-local outbound queue for Spinosa workspace prompts.
 *
 * One prompt, one row, one id. Enter admits a message here FIRST (visible
 * instantly as an optimistic transcript row) under a canonical prompt id
 * (`key`), stamped into the admission so the server echo carries it back.
 * A per-session dispatcher sends entries when the session is
 * idle, strictly one active at a time. Render order is always chronological
 * — steer never moves a row, it only flips status (dispatch priority
 * follows first-steered-wins, visualized with a #N counter):
 *
 *   queued ──steer──→ steered
 *      └──────────────┴──→ sent ──echo──→ gone (server row swaps in)
 *                       ↘ interrupted (receipt, rests in place)
 *                       ↘ failed (receipt, rests in place)
 *
 * A row dies ONLY when its server echo is observed. Slow echo degrades to
 * a stale mark, never a delete. Cancel/failure change status in place —
 * sent-but-blocked rows simply rest in the conversation as normal.
 *
 * Nothing here touches the server protocol: the prompt id rides the same
 * part-metadata channel as the route badge. No durable state.
 * Server admission still happens exactly once per prompt, at dispatch time.
 */

/** Part-metadata key carrying the canonical prompt id through admission to echo. */
export const SPINOSA_PROMPT_METADATA = "spinosaPrompt"

export type OutboundState = "queued" | "steered" | "sent" | "interrupted" | "failed"

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
  /**
   * Canonical prompt id: unique per enqueue, stamped into the admission and
   * echoed back by the server. Identifies the prompt in queue, cancel, and
   * echo-handoff alike. (Never a server id — the server row arrives later.)
   */
  key: string
  sessionID: string
  text: string
  snapshot: OutboundSnapshot
  dispatch: DispatchContext
  createdAt: number
  state: OutboundState
  /** Steer sequence: first-steered dispatches first. Render order never moves. */
  steeredAt?: number
  /** Set when admission kicks off; drives the stale "confirming…" display. */
  sentAt?: number
  /** Echo overdue but row kept: sent-but-blocked rests in place as normal. */
  stale?: boolean
  /** Admission-response id (V2 fast path); the stamped prompt id stays primary. */
  admittedID?: string
}

let keyCounter = 0
let steerCounter = 0
function nextKey(): string {
  keyCounter += 1
  // Zero-padded counter: same-millisecond ties break by key string, which
  // must preserve insertion order across digit boundaries (9 → 10).
  return `outbound-${Date.now().toString(36)}-${String(keyCounter).padStart(6, "0")}`
}

/**
 * Bounded history only: live entries (queued/steered/sent) are never
 * evicted — dropping one loses a send the input already cleared for.
 * Only settled receipts (interrupted/failed) roll off, oldest first.
 */
const MAX_INTERRUPTED_RECEIPTS = 20
const MAX_FAILED_RECEIPTS = 20

const [entriesBySession, setEntriesBySession] = createStore<Record<string, OutboundEntry[]>>({})

/** Single-flight dispatcher lease per session. Late owners cannot clear replacements. */
const pumpLeases = new Map<string, number>()
let pumpLeaseCounter = 0

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
      // Roll off oldest settled receipts only — live rows stay until
      // they dispatch, whatever the stress load.
      trimSettledReceipts(list)
    }),
  )
  return key
}

/** Drop oldest settled receipts (interrupted/failed) past their caps. Live rows never move. */
function trimSettledReceipts(list: OutboundEntry[]): void {
  trimReceiptState(list, "interrupted", MAX_INTERRUPTED_RECEIPTS)
  trimReceiptState(list, "failed", MAX_FAILED_RECEIPTS)
}

function trimReceiptState(list: OutboundEntry[], state: OutboundState, cap: number): void {
  const over = list.filter((entry) => entry.state === state).length - cap
  if (over <= 0) return
  const victims = new Set(
    list
      .filter((entry) => entry.state === state)
      .toSorted((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, over)
      .map((entry) => entry.key),
  )
  for (let at = list.length - 1; at >= 0; at--) {
    if (victims.has(list[at]!.key)) list.splice(at, 1)
  }
}

/** Oldest entry that hasn't settled as a receipt. Settled receipts never block the queue. */
export function peekOutbound(sessionID: string): OutboundEntry | undefined {
  return entriesBySession[sessionID]?.find((entry) => entry.state !== "interrupted" && entry.state !== "failed")
}

function compareDispatchPriority(a: OutboundEntry, b: OutboundEntry): number {
  // First-steered wins; unsteered follow in creation order.
  const aSteered = a.state === "steered" && a.steeredAt !== undefined
  const bSteered = b.state === "steered" && b.steeredAt !== undefined
  if (aSteered && bSteered) return a.steeredAt! - b.steeredAt!
  if (aSteered) return -1
  if (bSteered) return 1
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** Live entries in dispatch order (first to send first). Render stays insertion-ordered. */
export function dispatchOrderForSession(sessionID: string): OutboundEntry[] {
  return (entriesBySession[sessionID] ?? [])
    .filter((entry) => entry.state === "queued" || entry.state === "steered")
    .toSorted(compareDispatchPriority)
}

/** Next entry the pump should dispatch. */
export function peekDispatchable(sessionID: string): OutboundEntry | undefined {
  return dispatchOrderForSession(sessionID)[0]
}

/** 1-based dispatch position per live entry key (for the #N counter). */
export function dispatchPositions(sessionID: string): Map<string, number> {
  const positions = new Map<string, number>()
  dispatchOrderForSession(sessionID).forEach((entry, index) => {
    positions.set(entry.key, index + 1)
  })
  return positions
}

/** Reactive snapshot of a session's undispatched entries (rendering). */
export function outboundForSession(sessionID: string): OutboundEntry[] {
  return entriesBySession[sessionID] ?? []
}

/** Live entries that have not settled yet: queued, steered, sent. */
export function liveOutboundForSession(sessionID: string): OutboundEntry[] {
  return (entriesBySession[sessionID] ?? []).filter(
    (entry) => entry.state === "queued" || entry.state === "steered" || entry.state === "sent",
  )
}

/** Settled interrupted receipts — historical rows, rendered chronologically. */
export function interruptedOutboundForSession(sessionID: string): OutboundEntry[] {
  return (entriesBySession[sessionID] ?? [])
    .filter((entry) => entry.state === "interrupted")
    .toSorted((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** Settled failed receipts — historical rows, rendered chronologically. */
export function failedOutboundForSession(sessionID: string): OutboundEntry[] {
  return (entriesBySession[sessionID] ?? [])
    .filter((entry) => entry.state === "failed")
    .toSorted((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export type TranscriptMessageLike = {
  id: string
  time: { created: number }
}

export type MergedTranscriptRow<T extends TranscriptMessageLike = TranscriptMessageLike> =
  | { kind: "message"; message: T; messageIndex: number }
  | { kind: "outbound"; entry: OutboundEntry }

export function transcriptRowKey<T extends TranscriptMessageLike>(row: MergedTranscriptRow<T>): string {
  return row.kind === "outbound" ? `outbound:${row.entry.key}` : `message:${row.message.id}`
}

/** Reuse row objects when the message/entry identity has not changed. */
export function internTranscriptRows<T extends TranscriptMessageLike>(
  previous: readonly MergedTranscriptRow<T>[] | undefined,
  next: readonly MergedTranscriptRow<T>[],
): MergedTranscriptRow<T>[] {
  if (!previous || previous.length === 0) return [...next]
  const prevByKey = new Map(previous.map((row) => [transcriptRowKey(row), row] as const))
  return next.map((row) => {
    const old = prevByKey.get(transcriptRowKey(row))
    if (!old || old.kind !== row.kind) return row
    if (row.kind === "message" && old.kind === "message") {
      if (old.message === row.message && old.messageIndex === row.messageIndex) return old
      return row
    }
    if (row.kind === "outbound" && old.kind === "outbound" && old.entry === row.entry) return old
    return row
  })
}

function compareOutboundChronological(a: OutboundEntry, b: OutboundEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Merge server messages with EVERY outbound row in chronological order: one
 * list, positions frozen at birth. Live rows, interrupted and failed
 * receipts all scroll with the conversation; status flips happen in place,
 * never by moving rows between lists. An outbound entry sorts before the
 * first server message with `time.created` strictly greater than its
 * `createdAt`, so clock ties keep server order first.
 */
export function mergeTranscriptRows<T extends TranscriptMessageLike>(
  messages: readonly T[],
  entries: readonly OutboundEntry[],
  partsByMessageID?: Readonly<Record<string, readonly unknown[] | undefined>>,
): MergedTranscriptRow<T>[] {
  const visible = partsByMessageID ? withoutEchoedSentOutbound(entries, messages, partsByMessageID) : entries
  const pending = [...visible].sort(compareOutboundChronological)
  const rows: MergedTranscriptRow<T>[] = []
  let at = 0
  messages.forEach((message, messageIndex) => {
    const created = message.time.created
    while (at < pending.length && pending[at]!.createdAt < created) {
      rows.push({ kind: "outbound", entry: pending[at]! })
      at += 1
    }
    rows.push({ kind: "message", message, messageIndex })
  })
  while (at < pending.length) {
    rows.push({ kind: "outbound", entry: pending[at]! })
    at += 1
  }
  return rows
}

function promptIDFromPart(part: unknown): string | undefined {
  if (!part || typeof part !== "object" || !("metadata" in part)) return
  const metadata = (part as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object") return
  const value = (metadata as Record<string, unknown>)[SPINOSA_PROMPT_METADATA]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function promptIDFromParts(parts: readonly unknown[] | undefined): string | undefined {
  if (!parts) return
  for (const part of parts) {
    const id = promptIDFromPart(part)
    if (id) return id
  }
  return undefined
}

/** Genuine user text from synced parts (same join as the transcript row). */
export function userTextFromParts(parts: readonly unknown[] | undefined): string {
  if (!parts) return ""
  const texts: string[] = []
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const candidate = part as { type?: unknown; text?: unknown; synthetic?: unknown }
    if (candidate.type !== "text" || candidate.synthetic === true) continue
    if (typeof candidate.text !== "string") continue
    texts.push(candidate.text)
  }
  return texts.join("\n\n").trim()
}

/**
 * Find the server echo carrying a prompt id stamped at admission. Checks
 * part metadata (the same channel as the route badge), so every admission
 * path correlates — no envelope-shape or clock dependence.
 */
export function findEchoByPromptID(
  messages: readonly { id: string }[],
  partsByMessageID: Readonly<Record<string, readonly unknown[] | undefined>>,
  promptID: string,
): string | undefined {
  for (const message of messages) {
    const parts = partsByMessageID[message.id]
    if (!parts) continue
    for (const part of parts) {
      if (promptIDFromPart(part) === promptID) return message.id
    }
  }
  return undefined
}

export type OutboundEchoEntry = {
  key: string
  text: string
  admittedID?: string
}

/**
 * Resolve the persisted user row that replaces a sent optimistic row.
 * Prompt-id and admission-id win; same-text user rows cover echoes that
 * dropped the stamp so "✓ Sent" never sits next to "General prompt".
 */
export function findOutboundEcho(
  messages: readonly { id: string; role?: string }[],
  partsByMessageID: Readonly<Record<string, readonly unknown[] | undefined>>,
  entry: OutboundEchoEntry,
  claimed: ReadonlySet<string> = new Set(),
): string | undefined {
  const byPrompt = findEchoByPromptID(messages, partsByMessageID, entry.key)
  if (byPrompt && !claimed.has(byPrompt)) return byPrompt
  if (entry.admittedID && !claimed.has(entry.admittedID) && hasServerEcho(messages, entry.admittedID)) {
    return entry.admittedID
  }
  const want = entry.text.trim()
  if (!want) return undefined
  for (const message of messages) {
    if (claimed.has(message.id)) continue
    if (message.role && message.role !== "user") continue
    const parts = partsByMessageID[message.id]
    const stamped = promptIDFromParts(parts)
    if (stamped && stamped !== entry.key) continue
    if (userTextFromParts(parts) === want) return message.id
  }
  return undefined
}

/** Drop sent rows whose server echo is already in the transcript. */
export function withoutEchoedSentOutbound<T extends { id: string; role?: string }>(
  entries: readonly OutboundEntry[],
  messages: readonly T[],
  partsByMessageID: Readonly<Record<string, readonly unknown[] | undefined>>,
): OutboundEntry[] {
  const claimed = new Set<string>()
  return entries.filter((entry) => {
    if (entry.state !== "sent") return true
    const echo = findOutboundEcho(messages, partsByMessageID, entry, claimed)
    if (!echo) return true
    claimed.add(echo)
    return false
  })
}

/** Admission kicked off: the row stays visible as sent until the server echo takes over. */
export function markOutboundSent(sessionID: string, key: string): boolean {
  const head = peekDispatchable(sessionID)
  if (!head || head.key !== key || (head.state !== "queued" && head.state !== "steered")) return false
  const sentAt = Date.now()
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((candidate) => candidate.key === key)
      if (found && (found.state === "queued" || found.state === "steered")) {
        found.state = "sent"
        found.sentAt = sentAt
      }
    }),
  )
  return true
}

/**
 * Admission failed after the row flipped to sent: keep a failed receipt in
 * place with its text. The input box is never clobbered — the receipt IS
 * the record. Terminal state, trimmed by cap like interrupted.
 */
export function markOutboundFailed(sessionID: string, key: string): boolean {
  const entry = entriesBySession[sessionID]?.find((candidate) => candidate.key === key)
  if (!entry || (entry.state !== "queued" && entry.state !== "steered" && entry.state !== "sent")) return false
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((candidate) => candidate.key === key)
      if (found && (found.state === "queued" || found.state === "steered" || found.state === "sent")) {
        found.state = "failed"
      }
      const list = draft[sessionID]
      if (list) trimSettledReceipts(list)
    }),
  )
  return true
}

/** Echo overdue: the sent-but-blocked row rests in place, flagged stale. Never deletes. */
export function markOutboundStale(sessionID: string, key: string): boolean {
  const entry = entriesBySession[sessionID]?.find((candidate) => candidate.key === key)
  if (!entry || entry.state !== "sent") return false
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((candidate) => candidate.key === key)
      if (found?.state === "sent") found.stale = true
    }),
  )
  return true
}

export function removeOutbound(sessionID: string, key: string): void {
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
  invalidateOutboundPump(sessionID)
  setEntriesBySession(
    produce((draft) => {
      delete draft[sessionID]
    }),
  )
}

/** Current state of one prompt id, for echo-handoff guards. */
export function outboundEntryState(sessionID: string, key: string): OutboundState | undefined {
  return entriesBySession[sessionID]?.find((entry) => entry.key === key)?.state
}

/** Stash the admission-response id once known (secondary echo matcher). */
export function setOutboundAdmittedID(sessionID: string, key: string, admittedID: string): boolean {
  const entry = entriesBySession[sessionID]?.find((candidate) => candidate.key === key)
  if (!entry || entry.state !== "sent") return false
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((candidate) => candidate.key === key)
      if (found) found.admittedID = admittedID
    }),
  )
  return true
}

/** Preserve a cancelled queued/steered prompt as an explicit receipt. */
export function markOutboundInterrupted(sessionID: string, key: string): boolean {
  const entry = entriesBySession[sessionID]?.find((candidate) => candidate.key === key)
  if (!entry || (entry.state !== "queued" && entry.state !== "steered")) return false
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((candidate) => candidate.key === key)
      if (found && (found.state === "queued" || found.state === "steered")) found.state = "interrupted"
      const list = draft[sessionID]
      if (list) trimSettledReceipts(list)
    }),
  )
  return true
}

/**
 * Steer: flag a queued entry to dispatch next. Render order never moves —
 * only status flips. First-steered wins when several are steered. False
 * when the entry is gone or has already been steered or sent.
 */
export function steerOutbound(sessionID: string, key: string): boolean {
  const list = entriesBySession[sessionID]
  if (!list) return false
  const at = list.findIndex((e) => e.key === key)
  if (at < 0) return false
  if (list[at]?.state !== "queued") return false
  steerCounter += 1
  const stamped = steerCounter
  setEntriesBySession(
    produce((draft) => {
      const found = draft[sessionID]?.find((e) => e.key === key)
      if (!found || found.state !== "queued") return
      found.state = "steered"
      found.steeredAt = stamped
    }),
  )
  return true
}

/** Pump registry: the prompt component owns dispatch; other views kick it. */
type PumpRegistration = { generation: number; kick: () => void }
const pumpHandlers = new Map<string, PumpRegistration>()
let pumpOwnerCounter = 0

/**
 * Register the session pump, returning its generation. Cleanup must pass
 * the generation back: a stale unmount must never remove a newer mount's
 * registration for the same session.
 */
export function registerPump(sessionID: string, kick: () => void): number {
  pumpOwnerCounter += 1
  const generation = pumpOwnerCounter
  pumpHandlers.set(sessionID, { generation, kick })
  return generation
}

export function unregisterPump(sessionID: string, generation?: number): boolean {
  const current = pumpHandlers.get(sessionID)
  if (!current) return false
  if (generation !== undefined && current.generation !== generation) return false
  pumpHandlers.delete(sessionID)
  return true
}

export function kickPump(sessionID: string): void {
  try {
    pumpHandlers.get(sessionID)?.kick()
  } catch {
    /* pump kicks never throw into views */
  }
}

/** Echo-handoff tuning: poll for the admitted server id, then give up and drop the row. */
export const ECHO_WAIT_TIMEOUT_MS = 10_000
export const ECHO_WAIT_POLL_MS = 200

/** True once the server echo for an admitted message is visible. */
export function hasServerEcho(messages: readonly { id: string }[], admittedID: string): boolean {
  return messages.some((message) => message.id === admittedID)
}

/**
 * Extract the admitted user message id from a send response, tolerant of
 * envelope shapes: V2 `{ data: { id } }`, V1/command `{ data: { info: { parentID } } }`,
 * bare shell `AssistantMessage`. Parent ids win over own ids: a bare
 * assistant message carries its own id plus the user parentID, and the echo
 * we wait for is the user row. Undefined when nothing matchable admitted.
 */
export function admittedUserIDFromResponse(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined
  const root = response as { data?: unknown; info?: unknown; id?: unknown; parentID?: unknown }
  const scopes = [root.data, response].filter(
    (scope): scope is Record<string, unknown> => Boolean(scope) && typeof scope === "object",
  )
  const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0
  for (const scope of scopes) {
    const info = scope.info
    if (info && typeof info === "object") {
      const parentID = (info as { parentID?: unknown }).parentID
      if (nonEmpty(parentID)) return parentID
    }
    if (nonEmpty(scope.parentID)) return scope.parentID as string
  }
  for (const scope of scopes) {
    if (nonEmpty(scope.id)) return scope.id as string
  }
  return undefined
}

/** Poll `present` until true or timeout. Resolves false on timeout — never throws. */
export async function waitForEcho(
  present: () => boolean,
  timeoutMs: number = ECHO_WAIT_TIMEOUT_MS,
  pollMs: number = ECHO_WAIT_POLL_MS,
): Promise<boolean> {
  const startedAt = Date.now()
  for (;;) {
    try {
      if (present()) return true
    } catch {
      return false
    }
    if (Date.now() - startedAt >= timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

export function isOutboundPumping(sessionID: string): boolean {
  return pumpLeases.has(sessionID)
}

/** Acquire the session pump. Undefined means another owner is active. */
export function acquireOutboundPump(sessionID: string): number | undefined {
  if (pumpLeases.has(sessionID)) return
  pumpLeaseCounter += 1
  const lease = pumpLeaseCounter
  pumpLeases.set(sessionID, lease)
  return lease
}

export function ownsOutboundPump(sessionID: string, lease: number): boolean {
  return pumpLeases.get(sessionID) === lease
}

/** Release only when the caller still owns this exact pump generation. */
export function releaseOutboundPump(sessionID: string, lease: number): boolean {
  if (!ownsOutboundPump(sessionID, lease)) return false
  pumpLeases.delete(sessionID)
  return true
}

/** Invalidate a stuck/superseded pump without granting its continuations ownership. */
export function invalidateOutboundPump(sessionID: string): boolean {
  return pumpLeases.delete(sessionID)
}

/**
 * Esc-cancel ruling: restore the cancelled text into the input box only
 * when the user hasn't typed anything new since — never clobber fresh input.
 */
export function shouldRestoreCancelledText(cancelledText: string, currentInput: string): boolean {
  return cancelledText.length > 0 && currentInput.trim().length === 0
}
