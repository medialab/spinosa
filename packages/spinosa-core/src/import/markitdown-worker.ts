import { ProgressEmitter } from "../progress/progress"
import {
  processMarkitdownInProcess,
  type ClassifiedEntry,
  type PhaseResult,
} from "./pipeline"
import { decodeWorkerPayload } from "./worker-payload"

export interface MarkitdownWorkerInput {
  files: ClassifiedEntry[]
  logsDir: string
}

export function sendMarkitdownWorkerMessage(type: string, payload: Record<string, unknown> = {}): void {
  const line = `${JSON.stringify({ type, ...payload })}\n`
  const ok = process.stdout.write(line)
  if (!ok) {
    // Back-pressure: give kernel a chance to drain before caller exits.
    // Worker does not await this, but the drain listener prevents truncation
    // of the final progress/done messages when process.exit races.
    process.stdout.once("drain", () => {})
  }
}

async function drainStdout(): Promise<void> {
  if (process.stdout.writableLength === 0) return
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    // If already drained, `drain` may never fire — bound by timeout.
    const t = setTimeout(done, 250)
    process.stdout.once("drain", () => {
      clearTimeout(t)
      done()
    })
    // Kick the stream if write returned true but data still buffered.
    if (process.stdout.writableLength === 0) {
      clearTimeout(t)
      resolve()
    }
  })
}

/** Hard-exit on cancel signals so parent stop latency stays low (same as OCR). */
function installHardExitHandlers(): void {
  const exitNow = (signal: string) => {
    try {
      sendMarkitdownWorkerMessage("error", { message: `MarkItDown worker aborted by ${signal}` })
    } catch {
      // stdout may already be closed
    }
    process.exit(1)
  }
  process.once("SIGTERM", () => exitNow("SIGTERM"))
  process.once("SIGINT", () => exitNow("SIGINT"))
}

/** Shared MarkItDown worker entry for `bun run markitdown-worker.ts` and `spinosa internal markitdown-worker`. */
export async function runMarkitdownWorkerMain(input: MarkitdownWorkerInput): Promise<PhaseResult> {
  installHardExitHandlers()
  const { files, logsDir } = input
  const prog = new ProgressEmitter()
  prog.on((e) =>
    sendMarkitdownWorkerMessage("progress", {
      current: e.current,
      total: e.total,
      relPath: e.relPath,
      phase: e.phase,
      ...(e.status ? { status: e.status } : {}),
    }),
  )

  const result = await processMarkitdownInProcess(
    files,
    logsDir,
    prog,
    (msg) => sendMarkitdownWorkerMessage("log", { message: msg }),
    undefined,
    {
      inProcess: true,
      // Nested OCR must share this process group so parent cancel kills both.
      ocrDetached: false,
    },
  )

  sendMarkitdownWorkerMessage("done", {
    converted: result.converted,
    skipped: result.skipped,
    failed: result.failed,
    renamed: result.renamed,
    recoverable: result.recoverable,
  })
  await drainStdout()
  return result
}

async function main() {
  const input = decodeWorkerPayload(process.argv[2]) as MarkitdownWorkerInput
  if (!Array.isArray(input.files) || typeof input.logsDir !== "string") {
    throw new Error("markitdown worker payload must include files[] and logsDir")
  }
  await runMarkitdownWorkerMain(input)
  await drainStdout()
  // Small grace period so parent's `close` sees fully flushed stdio before we hard-exit.
  await new Promise<void>((r) => setTimeout(r, 25))
  process.exit(0)
}

if (import.meta.main) {
  main().catch((err) => {
    sendMarkitdownWorkerMessage("error", { message: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
