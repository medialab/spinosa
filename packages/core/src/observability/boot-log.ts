import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { productLogDir, sanitizeLogText, sanitizeLogValue } from "./sanitize-log"

const MAX_LOG_BYTES = 5 * 1024 * 1024
let processHandlersInstalled = false

function logDir(): string {
  return productLogDir()
}

function bootLogPath(): string {
  return path.join(logDir(), "boot.ndjson")
}

function ensureDir(dir: string): void {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    chmodSync(dir, 0o700)
  } catch {
    // Logging must never crash the product.
  }
}

function rotateLog(file: string): void {
  try {
    if (!existsSync(file)) return
    if (statSync(file).size < MAX_LOG_BYTES) return
    const previous = `${file}.1`
    rmSync(previous, { force: true })
    renameSync(file, previous)
  } catch {
    // Logging must never crash the product.
  }
}

function write(entry: Record<string, unknown>): void {
  try {
    ensureDir(logDir())
    const file = bootLogPath()
    rotateLog(file)
    appendFileSync(file, JSON.stringify(entry) + "\n", { mode: 0o600 })
    chmodSync(file, 0o600)
  } catch {
    // Logging must never crash the product.
  }
}

function isVerbose(): boolean {
  if (process.env.SPINOSA_VERBOSE_BOOT === "1" || process.env.SPINOSA_VERBOSE_BOOT === "true") return true
  return process.argv.some((a) => a === "--verbose")
}

function safeEntry(tag: string, message: string, extra?: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    ts: Date.now(),
    pid: process.pid,
    tag,
    msg: sanitizeLogText(message),
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      entry[key] = sanitizeLogValue(value, key)
    }
  }
  return entry
}

export function bootLog(tag: string, message: string, extra?: Record<string, unknown>): void {
  const entry = safeEntry(tag, message, extra)
  write(entry)
  if (isVerbose()) {
    console.error(`[boot:${tag}] ${String(entry.msg)}`)
  }
}

export function bootLogError(tag: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  bootLog(tag, msg, { level: "error", ...(stack ? { stack } : {}) })
}

/** Parent-process crash trail. The TUI worker installs its own handlers. */
export function installProcessFailureLogs(): void {
  if (processHandlersInstalled) return
  processHandlersInstalled = true
  process.on("unhandledRejection", (reason) => {
    bootLogError("process.unhandledRejection", reason)
  })
  process.on("uncaughtException", (error) => {
    bootLogError("process.uncaughtException", error)
  })
}
