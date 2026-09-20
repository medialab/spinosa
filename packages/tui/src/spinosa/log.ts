import { mkdirSync, appendFileSync, chmodSync, existsSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { productLogDir, sanitizeLogValue } from "@spinosa/kernel-core/observability/sanitize-log"

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
  | "step"
  | "action"
  | "phase"
  | "tool"
  | "error"
  | "result"
  | "tui"

const MAX_LOG_BYTES = 5 * 1024 * 1024

function logPath(): string {
  const logDir = productLogDir()
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

function logEntry(level: LogLevel, event: LogEvent, data: Record<string, unknown>) {
  try {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      event,
    }
    if (activeWorkspacePath) entry.ws = "$WORKSPACE"
    for (const [k, v] of Object.entries(data)) {
      entry[k] = sanitizeLogValue(v, k, activeWorkspacePath)
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

let _toastError: ((err: unknown) => void) | undefined
/** Register a toast callback — called by logError for visible error feedback */
export function setToastError(fn: (err: unknown) => void) {
  _toastError = fn
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

