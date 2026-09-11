import { mkdirSync, appendFileSync, chmodSync, existsSync, renameSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

let activeWorkspacePath: string | undefined

export function setActiveWorkspacePath(ws: string | undefined) {
  activeWorkspacePath = ws
}

/** Legacy plain-text logger — kept for backward compat */
export function tuiLog(message: string) {
  logEntry("info", "tui", { msg: message })
}

// ── Structured NDJSON logger ──────────────────────────────────────────

type LogLevel = "info" | "warn" | "error" | "debug"

type LogEvent =
  | "step"        // step transition
  | "action"      // user action (click, continue, back)
  | "phase"       // processing phase start/complete
  | "tool"        // tool check result
  | "error"       // error with stack
  | "result"      // processing result (converted/skipped/failed)
  | "gate"        // gate action triggered
  | "tui"         // generic TUI log

const MAX_LOG_BYTES = 5 * 1024 * 1024
const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key)/i

function logPath(): string {
  const logDir = path.join(process.env.SPINOSA_HOME ?? path.join(homedir(), ".spinosa"), "logs")
  mkdirSync(logDir, { recursive: true, mode: 0o700 })
  chmodSync(logDir, 0o700)
  return path.join(logDir, "tui.ndjson")
}

function rotateLog(file: string): void {
  if (!existsSync(file) || statSync(file).size < MAX_LOG_BYTES) return
  const previous = `${file}.1`
  rmSync(previous, { force: true })
  renameSync(file, previous)
}

function sanitizeLogText(value: string): string {
  let sanitized = value.replaceAll(homedir(), "~")
  if (activeWorkspacePath) sanitized = sanitized.replaceAll(activeWorkspacePath, "$WORKSPACE")
  return sanitized
    .replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)=([^\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    // Bare key material in prose (providers echo keys in errors; JSON blobs
    // land here via stringified error objects).
    .replace(/\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{8,}|xox[bap]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{10,})\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|token)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{12,}/gi, "$1[REDACTED]")
}

function sanitizeLogValue(value: unknown, key: string): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]"
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, key))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, sanitizeLogValue(child, childKey)]),
    )
  }
  return typeof value === "string" ? sanitizeLogText(value) : value
}

function logEntry(level: LogLevel, event: LogEvent, data: Record<string, unknown>) {
  try {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      event,
    }
    if (activeWorkspacePath) entry.ws = path.basename(activeWorkspacePath)
    for (const [k, v] of Object.entries(data)) {
      entry[k] = sanitizeLogValue(v, k)
    }
    const file = logPath()
    rotateLog(file)
    appendFileSync(file, JSON.stringify(entry) + "\n", { mode: 0o600 })
    chmodSync(file, 0o600)
  } catch {
    // best-effort
  }
}

/** Log a step transition */
export function logStep(step: string, detail?: string) {
  logEntry("info", "step", { step, msg: detail ?? `Entered ${step} step` })
}

/** Log a user action (button click, navigation) */
export function logAction(action: string, detail?: string, extra?: Record<string, unknown>) {
  logEntry("info", "action", { action, msg: detail ?? action, ...extra })
}

/** Log a processing phase event */
export function logPhase(phase: string, status: "start" | "complete" | "skip", detail?: string, extra?: Record<string, unknown>) {
  logEntry("info", "phase", { phase, status, msg: detail ?? `${phase} ${status}`, ...extra })
}

/** Log a tool check result */
export function logTool(tool: string, status: string, detail?: string) {
  logEntry("info", "tool", { tool, status, msg: detail ?? `${tool}: ${status}` })
}

/** Log a processing result */
export function logResult(phase: string, converted: number, skipped: number, failed: number, extra?: Record<string, unknown>) {
  logEntry("info", "result", { phase, converted, skipped, failed, msg: `${phase}: ${converted} converted, ${skipped} skipped, ${failed} failed`, ...extra })
}

/** Log a gate action */
export function logGate(label: string) {
  logEntry("info", "gate", { label, msg: `Gate: ${label}` })
}

let _toastError: ((err: unknown) => void) | undefined
/** Register a toast callback — called by logError for visible error feedback */
export function setToastError(fn: (err: unknown) => void) {
  _toastError = fn
}
export function getToastError() {
  return _toastError
}

/** Log an error with optional stack */
export function logError(context: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  logEntry("error", "error", { context, err: msg, ...(stack ? { stack } : {}), msg: `${context}: ${msg}` })
  _toastError?.(err)
}

/**
 * Persist wizard in-memory log lines to `~/.spinosa/logs/tui.ndjson` so the
 * verify/done “Details saved in …” hint is accurate when the UI no longer dumps them.
 */
export function persistImportWizardLogLines(lines: string[], context = "import-wizard") {
  for (const line of lines) {
    const msg = line.trimEnd()
    if (!msg) continue
    logEntry("info", "tui", { context, msg })
  }
}

