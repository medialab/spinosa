import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs"
import { productLogDir, sanitizeLogText } from "@spinosa/kernel-core/observability/sanitize-log"
import path from "node:path"

const MAX_LOG_BYTES = 5 * 1024 * 1024

function logFile(): string {
  const file = path.join(productLogDir(), "spinosa.log")
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  chmodSync(path.dirname(file), 0o700)
  return file
}

function rotateLog(file: string): void {
  if (!existsSync(file) || statSync(file).size < MAX_LOG_BYTES) return
  const previous = `${file}.1`
  rmSync(previous, { force: true })
  renameSync(file, previous)
}

function isoNow(): string {
  return new Date().toISOString()
}

export function spinosaLog(level: "INFO" | "WARN" | "ERROR", component: string, message: string): void {
  try {
    const file = logFile()
    rotateLog(file)
    const safeMessage = sanitizeLogText(message)
    const line = `${isoNow()} level=${level} component=${component} ${safeMessage}\n`
    appendFileSync(file, line, { mode: 0o600 })
    chmodSync(file, 0o600)
  } catch (e) { console.error("spinosa: failed to write log", e) }
}

export function spinosaLogInfo(component: string, message: string): void {
  spinosaLog("INFO", component, message)
}

export function spinosaLogWarn(component: string, message: string): void {
  spinosaLog("WARN", component, message)
}

export function spinosaLogError(component: string, message: string): void {
  spinosaLog("ERROR", component, message)
}
