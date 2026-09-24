import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { productLogDir, sanitizeLogText, sanitizeLogValue } from "./sanitize-log"

const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_ERROR_TEXT = 12_000
let processHandlersInstalled = false

function logDir(): string {
  return productLogDir()
}

function bootLogPath(): string {
  return path.join(logDir(), "boot.tui.ndjson")
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

function serializeError(error: unknown, depth = 0, seen = new Set<unknown>()): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) }
  if (seen.has(error)) return { message: "[Circular]" }
  seen.add(error)
  const result: Record<string, unknown> = { name: error.name, message: error.message.slice(0, MAX_ERROR_TEXT) }
  if (error.stack) result.stack = error.stack.slice(0, MAX_ERROR_TEXT)
  if (depth < 8 && error.cause !== undefined) result.cause = serializeError(error.cause, depth + 1, seen)
  return result
}

function formatErrorChain(error: unknown, depth = 0, seen = new Set<unknown>()): string {
  if (depth > 8) return "[error chain truncated]"
  if (!(error instanceof Error)) return String(error)
  if (seen.has(error)) return "[Circular]"
  seen.add(error)
  const lines = [`${error.name}: ${error.message}`]
  if (error.stack) lines.push(error.stack)
  if (error.cause !== undefined) lines.push(`Caused by:\n${formatErrorChain(error.cause, depth + 1, seen)}`)
  return lines.join("\n").slice(0, MAX_ERROR_TEXT)
}

export function bootLogError(tag: string, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error))
  bootLog(tag, normalized.message, {
    level: "error",
    ...serializeError(error),
    errorChain: formatErrorChain(error),
  })
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
