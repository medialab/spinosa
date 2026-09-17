import { createSpinosaClient } from "@spinosa/sdk/v2"
import type { GlobalEvent } from "@spinosa/sdk/v2"
import type { JobEvent } from "@spinosa/core/progress/job-event"
import { Flag } from "@spinosa/kernel-core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export type PublishJobEvent = (input: {
  directory?: string
  workspace?: string
  event: JobEvent
}) => void | Promise<void>

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
    publishJobEvent?: PublishJobEvent
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createSpinosaClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              sseMaxRetryAttempts: 0,
            })

            if (Flag.SPINOSA_EXPERIMENTAL_WORKSPACES) {
              // Start syncing workspaces, it's important to do this after
              // we've started listening to events
              await sdk.sync.start().catch(() => {})
            }

            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              handleEvent(event)
            }
          } catch {
            // Transport failure (connect, stream, or iterator): back off and
            // retry below. The loop must never die on a dropped connection —
            // a dead loop stops all server events with no recovery.
            if (abort.signal.aborted || ctrl.signal.aborted) break
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // A drop followed by a successful stream close means the connection
          // came back but events emitted while offline were lost. Tell the
          // sync layer to re-fetch volatile state instead of staying stale.
          if (attempt >= 1) {
            emitter.emit("event", { type: "connection.reconnected" } as unknown as Parameters<typeof emitter.emit>[1])
          }

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(() => {
      // Disposal registers synchronously: if the owner dies while the
      // injected subscription is still resolving, the late disposer releases
      // immediately instead of leaking (onCleanup after an await may have no
      // live owner left to attach to).
      let disposed = false
      let unsub: (() => void) | undefined
      onCleanup(() => {
        disposed = true
        unsub?.()
      })
      ;(async () => {
        if (props.events) {
          const release = await props.events.subscribe(handleEvent)
          if (disposed) {
            release()
            return
          }
          unsub = release

          if (Flag.SPINOSA_EXPERIMENTAL_WORKSPACES) {
            // Start syncing workspaces, it's important to do this after
            // we've started listening to events
            await sdk.sync.start().catch(() => {})
          }
        } else {
          startSSE()
        }
      })()
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
      publishJobEvent: props.publishJobEvent,
    }
  },
})
