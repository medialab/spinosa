import { Rpc } from "@/util/rpc"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { capturedSpinosaBootNoise } from "../../native/boot-noise"
import { bootLog, bootLogError } from "@spinosa/kernel-core/observability/boot-log"
import type { JobEvent } from "@spinosa/core/progress/job-event"

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
  bootLogError(`worker.${kind}`, error)
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

type WorkerRuntime = typeof import("./worker-runtime")
let runtimeModule: WorkerRuntime | undefined
const runtimePromise = import("./worker-runtime.ts").then((mod) => {
  runtimeModule = mod
  return mod
})

async function runtime() {
  return runtimePromise
}

export const rpc = {
  ping() {
    return { ok: true as const }
  },
  bootNoise() {
    return { lines: [...capturedSpinosaBootNoise()] }
  },
  async natives() {
    const mod = (await import("@spinosa/kernel-core/pty/pty.bun")) as { spawn?: unknown }
    return { pty: typeof mod.spawn === "function" }
  },
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    return (await runtime()).handleFetch(input)
  },
  snapshot() {
    return writeHeapSnapshot("server.heapsnapshot")
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    return (await runtime()).startServer(input)
  },
  async checkUpgrade(input: { directory: string }) {
    return (await runtime()).checkUpgrade(input)
  },
  async emitJobEvent(input: { directory?: string; workspace?: string; event: JobEvent }) {
    ;(await runtime()).emitJobEvent(input)
  },
  async reload() {
    return (await runtime()).reload()
  },
  async shutdown() {
    bootLog("worker.shutdown", "shutting down worker")
    if (runtimeModule) await runtimeModule.shutdown()
    if (heartbeat) clearInterval(heartbeat)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
    bootLog("worker.shutdown.done", "worker shutdown complete")
  },
}

Rpc.listen(rpc)
