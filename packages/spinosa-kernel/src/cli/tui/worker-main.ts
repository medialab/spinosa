import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { Config } from "@/config/config"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { publishJobEvent } from "@/job/bus"
import type { JobEvent } from "@spinosa/core/progress/job-event"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { bootLog } from "@spinosa/kernel-core/observability/boot-log"

Heap.start()
bootLog("worker.init", "TUI background worker started", { pid: process.pid })

const heartbeat =
  process.env.SPINOSA_VERBOSE_BOOT === "1"
    ? setInterval(() => {
        bootLog("worker.alive", "worker event loop running", { rss: process.memoryUsage().rss })
      }, 2000)
    : undefined

let fatal = false

function reportWorkerError(kind: "unhandledRejection" | "uncaughtException", error: unknown): string {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`TUI worker ${kind}: ${detail}\n`)
  bootLog("worker.error", `TUI worker ${kind}`, { error: String(error) })
  return detail
}

/**
 * Soften unhandledRejection: Spinosa long ops (import/OCR) run in the parent
 * with killable JobRunner children, so a stray rejection must not tear down the
 * session server. Uncaught exceptions still hard-exit — process integrity may
 * already be compromised.
 */
const onUnhandledRejection = (error: unknown) => {
  reportWorkerError("unhandledRejection", error)
}

const onUncaughtException = (error: Error) => {
  reportWorkerError("uncaughtException", error)
  if (fatal) return
  fatal = true
  process.exitCode = 1
  queueMicrotask(() => process.exit(1))
}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
const onGlobalEvent = (event: GlobalEvent) => {
  Rpc.emit("global.event", event)
}
GlobalBus.on("event", onGlobalEvent)

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    bootLog("worker.fetch", "proxying fetch", { url: input.url, method: input.method })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    bootLog("worker.server", "starting server", { port: input.port, hostname: input.hostname })
    server = await Server.listen(input)
    const url = server.url.toString()
    bootLog("worker.server.running", "server is listening", { url })
    return { url }
  },
  async checkUpgrade(input: { directory: string }) {
    // Legacy RPC name. Launch preflight in cmd/tui.ts handles framework upgrades.
    bootLog("worker.checkUpgrade", "loading instance", { directory: input.directory })
    try {
      await InstanceRuntime.load({ directory: input.directory })
    } catch (e) {
      bootLog("worker.checkUpgrade.load.error", "InstanceRuntime.load failed", { error: String(e) })
    }
  },
  /** Parent-process import progress → worker GlobalBus (SSE + global.event RPC). */
  async emitJobEvent(input: { directory?: string; workspace?: string; event: JobEvent }) {
    publishJobEvent(input)
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    bootLog("worker.shutdown", "shutting down worker")
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    if (heartbeat) clearInterval(heartbeat)
    GlobalBus.off("event", onGlobalEvent)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
    bootLog("worker.shutdown.done", "worker shutdown complete")
  },
}

Rpc.listen(rpc)
