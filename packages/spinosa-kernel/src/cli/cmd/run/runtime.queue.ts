// Serial prompt queue for direct interactive mode.
//
// Prompts arrive from the footer and are drained one turn at a time. Ordinary
// prompts submitted during an active turn remain locally editable until they
// begin. Queue lifecycle and individual turn execution are kept separate so
// close/abort behavior stays easy to audit.
import * as Locale from "@/util/locale"
import { MessageID, PartID } from "@/session/schema"
import { isExitCommand, isNewCommand } from "./prompt.shared"
import type { FooterApi, FooterEvent, FooterQueuedPrompt, RunPrompt } from "./types"

type Trace = { write(type: string, data?: unknown): void }

type Deferred<T = void> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (error?: unknown) => void
}

export type QueueInput = {
  footer: FooterApi
  initialInput?: string
  trace?: Trace
  onSend?: (prompt: RunPrompt) => void
  onNewSession?: () => void | Promise<void>
  run: (prompt: RunPrompt, signal: AbortSignal) => Promise<void>
}

type State = {
  queue: RunPrompt[]
  queued: FooterQueuedPrompt[]
  active?: RunPrompt
  ctrl?: AbortController
  closed: boolean
}

type QueueRuntime = {
  input: QueueInput
  state: State
  stop: Deferred<{ type: "closed" }>
  done: Deferred
  draining?: Promise<void>
}

function defer<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function emit(runtime: QueueRuntime, next: FooterEvent, row: Record<string, unknown>) {
  runtime.input.trace?.write("ui.patch", row)
  runtime.input.footer.event(next)
}

function syncQueue(runtime: QueueRuntime) {
  const { state } = runtime
  const queue = state.queue.length
  emit(runtime, { type: "queue", queue }, { queue })
  emit(
    runtime,
    {
      type: "queued.prompts",
      prompts: [...state.queued],
    },
    { queued: state.queued.length },
  )
}

function removeLocalQueued(runtime: QueueRuntime, queued: FooterQueuedPrompt) {
  const { state } = runtime
  if (!state.queued.includes(queued)) return
  state.queued = state.queued.filter((item) => item !== queued)
  syncQueue(runtime)
}

function finish(runtime: QueueRuntime) {
  if (!runtime.state.closed || runtime.draining) return
  runtime.done.resolve()
}

function closeQueue(runtime: QueueRuntime) {
  const { state } = runtime
  if (state.closed) return
  state.closed = true
  state.queue.length = 0
  state.queued.length = 0
  state.ctrl?.abort()
  runtime.stop.resolve({ type: "closed" })
  finish(runtime)
}

async function processNewSession(runtime: QueueRuntime): Promise<void> {
  const { input, state } = runtime
  syncQueue(runtime)
  if (!input.onNewSession) {
    emit(
      runtime,
      {
        type: "stream.patch",
        patch: { status: "new sessions unavailable" },
      },
      { status: "new sessions unavailable" },
    )
    return
  }

  emit(
    runtime,
    {
      type: "stream.patch",
      patch: {
        phase: "running",
        status: "starting new session",
        queue: state.queue.length,
      },
    },
    {
      phase: "running",
      status: "starting new session",
      queue: state.queue.length,
    },
  )
  await input.onNewSession()
}

function queuedPrompt(runtime: QueueRuntime, prompt: RunPrompt) {
  const queued = runtime.state.queued.find((item) => item.prompt === prompt)
  if (queued) removeLocalQueued(runtime, queued)
  return queued
}

async function runTurn(runtime: QueueRuntime, prompt: RunPrompt, queued?: FooterQueuedPrompt): Promise<boolean> {
  const { input, state } = runtime
  const sent =
    prompt.mode === "shell"
      ? prompt
      : {
          ...prompt,
          messageID: prompt.messageID ?? queued?.messageID ?? MessageID.ascending(),
        }
  state.active = sent
  emit(
    runtime,
    { type: "turn.send", queue: state.queue.length },
    { phase: "running", status: "sending prompt", queue: state.queue.length },
  )

  const start = Date.now()
  const ctrl = new AbortController()
  state.ctrl = ctrl
  try {
    await input.footer.idle()
    if (state.closed) return false

    if (sent.mode !== "shell") {
      const commit = {
        kind: "user",
        text: sent.text,
        phase: "start",
        source: "system",
        messageID: sent.messageID,
      } as const
      input.trace?.write("ui.commit", commit)
      input.footer.append(commit)
    }

    input.onSend?.(sent)
    if (state.closed) return false

    const task = input.run(sent, ctrl.signal).then(
      () => ({ type: "done" as const }),
      (error) => ({ type: "error" as const, error }),
    )
    const next = await Promise.race([task, runtime.stop.promise])
    if (next.type === "closed") {
      ctrl.abort()
      return false
    }
    if (next.type === "error") throw next.error
    return true
  } finally {
    if (state.ctrl === ctrl) state.ctrl = undefined
    if (sent.mode !== "shell") {
      const duration = Locale.duration(Math.max(0, Date.now() - start))
      emit(runtime, { type: "turn.duration", duration }, { duration })
    }
    state.active = undefined
  }
}

async function processPrompt(runtime: QueueRuntime, prompt: RunPrompt): Promise<boolean> {
  const queued = queuedPrompt(runtime, prompt)
  if (prompt.mode !== "shell" && isNewCommand(prompt.text)) {
    await processNewSession(runtime)
    return true
  }
  return runTurn(runtime, prompt, queued)
}

function drainQueue(runtime: QueueRuntime) {
  const { state } = runtime
  if (runtime.draining || state.closed || state.queue.length === 0) return

  runtime.draining = (async () => {
    try {
      while (!state.closed && state.queue.length > 0) {
        const prompt = state.queue.shift()
        if (!prompt) continue
        if (!(await processPrompt(runtime, prompt))) break
      }
    } catch (error) {
      runtime.done.reject(error)
      return
    } finally {
      runtime.draining = undefined
      emit(
        runtime,
        { type: "turn.idle", queue: state.queue.length },
        { phase: "idle", status: "", queue: state.queue.length },
      )
    }
    finish(runtime)
  })()
}

function submitPrompt(runtime: QueueRuntime, prompt: RunPrompt) {
  const { input, state } = runtime
  if (!prompt.text.trim() || state.closed) return
  if (prompt.mode !== "shell" && isExitCommand(prompt.text)) {
    input.footer.close()
    return
  }

  const active = state.active
  const canQueue =
    active &&
    active.mode !== "shell" &&
    !active.command &&
    prompt.mode !== "shell" &&
    !prompt.command &&
    !isNewCommand(prompt.text)
  if (canQueue) {
    const queued: FooterQueuedPrompt = {
      messageID: MessageID.ascending(),
      partID: PartID.ascending(),
      prompt,
    }
    state.queued = [...state.queued, queued]
    state.queue.push(prompt)
    syncQueue(runtime)
    return
  }

  state.queue.push(prompt)
  syncQueue(runtime)
  if (prompt.mode !== "shell" && isNewCommand(prompt.text)) {
    drainQueue(runtime)
    return
  }

  emit(runtime, { type: "first", first: false }, { first: false })
  drainQueue(runtime)
}

function removeQueued(runtime: QueueRuntime, messageID: string): boolean {
  const { state } = runtime
  const queued = state.queued.find((item) => item.messageID === messageID)
  if (!queued) return false
  state.queue = state.queue.filter((prompt) => prompt !== queued.prompt)
  removeLocalQueued(runtime, queued)
  return true
}

function steerQueued(runtime: QueueRuntime, messageID: string): boolean {
  const { state } = runtime
  const queued = state.queued.find((item) => item.messageID === messageID)
  if (!queued) return false
  state.queue = state.queue.filter((prompt) => prompt !== queued.prompt)
  state.queue.unshift(queued.prompt)
  state.ctrl?.abort()
  syncQueue(runtime)
  return true
}

// Runs prompt queue until footer closes. Footer subscriptions only translate
// user actions into state operations; the async drain owns turn ordering.
export async function runPromptQueue(input: QueueInput): Promise<void> {
  const runtime: QueueRuntime = {
    input,
    stop: defer<{ type: "closed" }>(),
    done: defer(),
    state: {
      queue: [],
      queued: [],
      closed: input.footer.isClosed,
    },
  }

  const offPrompt = input.footer.onPrompt((prompt) => submitPrompt(runtime, prompt))
  const offClose = input.footer.onClose(() => closeQueue(runtime))
  const offRemoveQueued = input.footer.onQueuedRemove((messageID) => removeQueued(runtime, messageID))
  const offSteerQueued = input.footer.onQueuedSteer((messageID) => steerQueued(runtime, messageID))

  try {
    if (runtime.state.closed) return
    submitPrompt(runtime, { text: input.initialInput ?? "", parts: [] })
    finish(runtime)
    await runtime.done.promise
  } finally {
    offPrompt()
    offClose()
    offRemoveQueued()
    offSteerQueued()
    closeQueue(runtime)
    await runtime.draining?.catch(() => {})
  }
}
