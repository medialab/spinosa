import { appendFileSync, chmodSync, mkdirSync } from "node:fs"
import path from "path"
import { productLogDir, sanitizeLogValue } from "@spinosa/kernel-core/observability/sanitize-log"

function logPath() {
  return path.join(productLogDir(), "debug.tui.ndjson")
}

/**
 * Write a structured debug log entry to ~/.spinosa/logs/debug.tui.ndjson.
 */
export function dbg(tag: string, data: Record<string, unknown>): void {
  const safeData = sanitizeLogValue(data) as Record<string, unknown>
  const entry = { ts: Date.now(), tag, ...safeData }
  const line = JSON.stringify(entry) + "\n"
  try {
    const file = logPath()
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    chmodSync(path.dirname(file), 0o700)
    appendFileSync(file, line, { mode: 0o600 })
    chmodSync(file, 0o600)
  } catch {
    // log file unavailable — best-effort
  }
  console.error(`[${tag}]`, ...Object.entries(safeData).flat())
}
