import type { Event, GlobalEvent, OpencodeClient } from "@spinosa/sdk/v2"
import { Deferred, Effect, Exit } from "effect"
import { blockerStatus, pickBlockerView, type SessionData } from "./session-data"
import { listSubagentPermissions, listSubagentQuestions, sameSubagentTab, type SubagentData } from "./subagent-data"
import type {
  FooterOutput,
  FooterPatch,
  FooterSubagentState,
  FooterSubagentTab,
  FooterView,
  RunFilePart,
  RunInput,
  RunPrompt,
  RunPromptPart,
} from "./types"

export type StreamTrace = {
  write(type: string, data?: unknown): void
}

type PromptRequest = Parameters<OpencodeClient["session"]["promptAsync"]>[0]
type CommandRequest = Parameters<OpencodeClient["session"]["command"]>[0]

type RequestInput = {
  sessionID: string
  prompt: RunPrompt
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
  files: RunFilePart[]
  includeFiles: boolean
}

export function buildPromptRequest(input: RequestInput): PromptRequest {
  return {
    sessionID: input.sessionID,
    messageID: input.prompt.messageID,
    agent: input.agent,
    model: input.model,
    variant: input.variant,
    parts: [
      ...(input.includeFiles ? input.files : []),
      { type: "text" as const, text: input.prompt.text },
      ...input.prompt.parts,
    ],
  }
}

export function buildCommandRequest(
  input: RequestInput & { command: NonNullable<RunPrompt["command"]> },
): CommandRequest {
  return {
    sessionID: input.sessionID,
    messageID: input.prompt.messageID,
    agent: input.agent,
    model: input.model ? `${input.model.providerID}/${input.model.modelID}` : undefined,
    variant: input.variant,
    command: input.command.name,
    arguments: input.command.arguments,
    parts: [
      ...(input.includeFiles ? input.files : []),
      ...input.prompt.parts.filter(
        (item): item is Extract<RunPromptPart, { type: "file" }> => item.type === "file",
      ),
    ],
  }
}

export function sid(event: Event): string | undefined {
  if (event.type === "message.updated") {
    return event.properties.sessionID
  }

  if (event.type === "message.part.delta") {
    return event.properties.sessionID
  }

  if (event.type === "message.part.updated") {
    return event.properties.part.sessionID
  }

  if (
    event.type === "session.next.shell.started" ||
    event.type === "session.next.shell.ended" ||
    event.type === "permission.asked" ||
    event.type === "permission.replied" ||
    event.type === "question.asked" ||
    event.type === "question.replied" ||
    event.type === "question.rejected" ||
    event.type === "session.error" ||
    event.type === "session.status"
  ) {
    return event.properties.sessionID
  }

  return undefined
}

export function isEvent(value: unknown): value is Event {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const type = Reflect.get(value, "type")
  const properties = Reflect.get(value, "properties")
  return typeof type === "string" && !!properties && typeof properties === "object"
}

export function isGlobalEvent(value: unknown): value is GlobalEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const payload = Reflect.get(value, "payload")
  return !!payload && typeof payload === "object"
}

export function globalPayloadEvent(value: unknown): Event | undefined {
  if (!isGlobalEvent(value)) {
    return undefined
  }

  const payload = value.payload
  if (payload.type === "sync") {
    return undefined
  }

  return isEvent(payload) ? payload : undefined
}

export function isMatchingDisposeEvent(value: unknown, directory: string | undefined): boolean {
  if (!directory || !isGlobalEvent(value)) {
    return false
  }

  if (value.directory !== directory) {
    return false
  }

  return value.payload.type === "server.instance.disposed"
}

export function active(event: Event, sessionID: string): boolean {
  if (sid(event) !== sessionID) {
    return false
  }

  if (event.type === "message.updated") {
    return event.properties.info.role === "assistant"
  }

  if (event.type === "message.part.delta" || event.type === "message.part.updated") {
    return false
  }

  if (event.type !== "session.status") {
    return true
  }

  return event.properties.status.type !== "idle"
}

export function waitTurn(done: Deferred.Deferred<void, unknown>, signal: AbortSignal) {
  return Effect.raceAll([
    Deferred.await(done).pipe(Effect.as("idle" as const), Effect.exit),
    Effect.callback<"abort">((resume) => {
      if (signal.aborted) {
        resume(Effect.succeed("abort"))
        return Effect.void
      }

      const onAbort = () => {
        signal.removeEventListener("abort", onAbort)
        resume(Effect.succeed("abort"))
      }

      signal.addEventListener("abort", onAbort, { once: true })
      return Effect.sync(() => signal.removeEventListener("abort", onAbort))
    }).pipe(Effect.exit),
  ]).pipe(Effect.flatMap((exit) => (Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.succeed(exit.value))))
}

export function formatUnknownError(error: unknown): string {
  if (typeof error === "string") {
    return error
  }

  if (error instanceof Error) {
    return error.message || error.name
  }

  if (error && typeof error === "object") {
    const value = error as { message?: unknown; name?: unknown }
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message
    }

    if (typeof value.name === "string" && value.name.trim()) {
      return value.name
    }
  }

  return "unknown error"
}

function sameView(a: FooterView, b: FooterView) {
  if (a.type !== b.type) {
    return false
  }

  if (a.type === "prompt" && b.type === "prompt") {
    return true
  }

  if (a.type === "prompt" || b.type === "prompt") {
    return false
  }

  return a.request === b.request
}

function blockerOrder(order: Map<string, number>, id: string) {
  return order.get(id) ?? Number.MAX_SAFE_INTEGER
}

function firstByOrder<T extends { id: string }>(left: T[], right: T[], order: Map<string, number>) {
  return [...left, ...right].sort((a, b) => {
    const next = blockerOrder(order, a.id) - blockerOrder(order, b.id)
    if (next !== 0) {
      return next
    }

    return a.id.localeCompare(b.id)
  })[0]
}

export function pickView(data: SessionData, subagent: SubagentData, order: Map<string, number>): FooterView {
  return pickBlockerView({
    permission: firstByOrder(data.permissions, listSubagentPermissions(subagent), order),
    question: firstByOrder(data.questions, listSubagentQuestions(subagent), order),
  })
}

export function composeFooter(input: {
  patch?: FooterPatch
  subagent?: FooterSubagentState
  current: FooterView
  previous: FooterView
}): FooterOutput | undefined {
  let footer: FooterOutput | undefined

  if (input.subagent) {
    footer = {
      ...footer,
      subagent: input.subagent,
    }
  }

  if (!sameView(input.previous, input.current)) {
    footer = {
      ...footer,
      view: input.current,
    }
  }

  if (input.current.type !== "prompt") {
    footer = {
      ...footer,
      patch: {
        ...input.patch,
        status: blockerStatus(input.current),
      },
    }
    return footer
  }

  if (input.patch) {
    footer = {
      ...footer,
      patch: input.patch,
    }
    return footer
  }

  if (input.previous.type !== "prompt") {
    footer = {
      ...footer,
      patch: {
        status: "",
      },
    }
  }

  return footer
}

export function traceTabs(trace: StreamTrace | undefined, prev: FooterSubagentTab[], next: FooterSubagentTab[]) {
  const before = new Map(prev.map((item) => [item.sessionID, item]))
  const after = new Map(next.map((item) => [item.sessionID, item]))

  for (const [sessionID, tab] of after) {
    if (sameSubagentTab(before.get(sessionID), tab)) {
      continue
    }

    trace?.write("subagent.tab", {
      sessionID,
      tab,
    })
  }

  for (const sessionID of before.keys()) {
    if (after.has(sessionID)) {
      continue
    }

    trace?.write("subagent.tab", {
      sessionID,
      cleared: true,
    })
  }
}
