import { existsSync, readFileSync } from "node:fs"
import { release } from "node:os"
import path from "node:path"
import open from "open"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"
import { productLogDir, sanitizeLogText, sanitizeLogValue } from "@spinosa/kernel-core/observability/sanitize-log"

export const BUG_REPORT_ISSUES_URL = "https://github.com/medialab/spinosa/issues"
export const BUG_REPORT_NEW_URL = "https://github.com/medialab/spinosa/issues/new"
export const BUG_REPORT_TEMPLATE = "bug_report.yml"
export const MAX_BUG_REPORT_URL_LENGTH = 6000

export const BUG_REPORT_CONFIRM_TITLE = "Report a bug"
export const BUG_REPORT_CONFIRM_MESSAGE =
  "This opens a GitHub issue form in your browser. Logs are sanitized (no paths, secrets, or model answers). Nothing is posted until you Submit on GitHub. Destination: github.com/medialab/spinosa/issues"

const CONTENT_KEYS =
  /^(content|prompt|text|body|messages|output|input|args|argv|parts|transcript|completion|response|delta)$/i
const REPORT_FILES = ["boot.ndjson.1", "boot.ndjson", "tui.ndjson.1", "tui.ndjson"] as const
const TRUNCATE_MARKER = "\n... (truncated)"
const MAX_MSG_CHARS = 400
const MAX_STACK_CHARS = 800
const DEFAULT_MAX_LOG_LINES = 40
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000
const EMPTY_LOGS = "No recent TUI or boot log lines in the last two hours."

export type BugReportKind = "crash" | "user"

export type BugReportInput = {
  kind: BugReportKind
  title?: string
  message?: string
  stack?: string
  logs?: string
  version?: string
}

export type OpenBugReportResult = "opened" | "copied" | "failed"

export function describeOS() {
  const name =
    process.platform === "darwin"
      ? "macOS"
      : process.platform === "win32"
        ? "Windows"
        : process.platform === "linux"
          ? "Linux"
          : process.platform
  return `${name} ${release()} (${process.arch})`
}

export function describeTerminal() {
  const program = process.env.TERM_PROGRAM || process.env.TERM || "unknown"
  const version = process.env.TERM_PROGRAM_VERSION ? ` ${process.env.TERM_PROGRAM_VERSION}` : ""
  const multiplexer = process.env.TMUX ? " in tmux" : process.env.STY ? " in screen" : ""
  return `${program}${version}${multiplexer}`
}

function isAttachable(entry: Record<string, unknown>): boolean {
  if (entry.role === "assistant") return false
  const level = typeof entry.level === "string" ? entry.level.toLowerCase() : ""
  if (level === "debug") return false
  return true
}

function isErrorLike(entry: Record<string, unknown>): boolean {
  const level = typeof entry.level === "string" ? entry.level.toLowerCase() : ""
  if (level === "error" || level === "warn") return true
  if (entry.event === "error") return true
  const tag = typeof entry.tag === "string" ? entry.tag : ""
  if (/error|fail|crash|uncaught|unhandled|exception/i.test(tag)) return true
  return typeof entry.stack === "string" && entry.stack.length > 0
}

function capString(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

function compactLogLine(entry: Record<string, unknown>): string | undefined {
  if (!isAttachable(entry)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (CONTENT_KEYS.test(key)) continue
    if (key === "ws") {
      out.ws = "$WORKSPACE"
      continue
    }
    let next = sanitizeLogValue(value, key)
    if (typeof next === "string") {
      if (key === "msg") next = capString(next, MAX_MSG_CHARS)
      else if (key === "stack" || key === "chain" || next.length > MAX_STACK_CHARS) {
        next = capString(next, MAX_STACK_CHARS)
      }
    }
    out[key] = next
  }
  return JSON.stringify(out)
}

function fingerprintLogLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const { ts: _ts, ...rest } = parsed
    return JSON.stringify(rest)
  } catch {
    return line
  }
}

export function groupRepeatedLogLines(lines: string[]): string[] {
  const groups: { line: string; key: string; count: number }[] = []
  for (const line of lines) {
    const key = fingerprintLogLine(line)
    const last = groups.at(-1)
    if (last && last.key === key) {
      last.count += 1
      continue
    }
    groups.push({ line, key, count: 1 })
  }
  return groups.map((group) => (group.count > 1 ? `${group.line} x${group.count}` : group.line))
}

function entryTime(entry: Record<string, unknown>, fallback: number): number {
  const ts = entry.ts
  if (typeof ts === "number" && Number.isFinite(ts)) return ts
  if (typeof ts === "string") {
    const parsed = Date.parse(ts)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

export function collectRecentErrorLogs(options?: {
  logDir?: string
  maxLines?: number
  maxAgeMs?: number
}): string {
  const logDir = options?.logDir ?? productLogDir()
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LOG_LINES
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const now = Date.now()
  const cutoff = now - maxAgeMs
  const rows: { time: number; line: string; error: boolean }[] = []

  for (const name of REPORT_FILES) {
    const file = path.join(logDir, name)
    if (!existsSync(file)) continue
    let text = ""
    try {
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(raw) as Record<string, unknown>
      } catch {
        continue
      }
      if (!entry || typeof entry !== "object") continue
      const time = entryTime(entry, now)
      if (time < cutoff) continue
      const line = compactLogLine(entry)
      if (!line) continue
      rows.push({ time, line, error: isErrorLike(entry) })
    }
  }

  rows.sort((a, b) => a.time - b.time)
  const groups: { time: number; line: string; error: boolean; key: string; count: number }[] = []
  for (const row of rows) {
    const key = fingerprintLogLine(row.line)
    const last = groups.at(-1)
    if (last && last.key === key) {
      last.count += 1
      last.time = row.time
      last.error = last.error || row.error
      continue
    }
    groups.push({ time: row.time, line: row.line, error: row.error, key, count: 1 })
  }
  const formatted = groups.map((group) => ({
    time: group.time,
    error: group.error,
    line: group.count > 1 ? `${group.line} x${group.count}` : group.line,
  }))

  const errors = formatted.filter((row) => row.error)
  const info = formatted.filter((row) => !row.error)
  const selected = errors.slice(-maxLines)
  const remaining = maxLines - selected.length
  if (remaining > 0) selected.push(...info.slice(-remaining))
  selected.sort((a, b) => a.time - b.time)
  if (selected.length === 0) return EMPTY_LOGS
  return selected.map((row) => row.line).join("\n")
}

function sanitizeBlock(value: string | undefined): string {
  if (!value) return ""
  return sanitizeLogText(value)
}

function applyParams(url: URL, params: Record<string, string>) {
  url.search = ""
  url.searchParams.set("template", BUG_REPORT_TEMPLATE)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
}

function fitUrl(params: Record<string, string>): URL {
  const url = new URL(BUG_REPORT_NEW_URL)
  applyParams(url, params)
  if (url.toString().length <= MAX_BUG_REPORT_URL_LENGTH) return url

  const logs = params.logs ?? ""
  if (logs) {
    let lo = 0
    let hi = logs.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      applyParams(url, { ...params, logs: logs.slice(0, mid) + TRUNCATE_MARKER })
      if (url.toString().length <= MAX_BUG_REPORT_URL_LENGTH) lo = mid
      else hi = mid - 1
    }
    applyParams(url, { ...params, logs: logs.slice(0, lo) + TRUNCATE_MARKER })
    if (url.toString().length <= MAX_BUG_REPORT_URL_LENGTH) return url
  }

  const next: Record<string, string> = { ...params, logs: "(truncated)" }
  const actual = next.actual ?? ""
  if (actual.length > 120) next.actual = capString(actual, 120)
  applyParams(url, next)
  return url
}

function environmentBlock(version: string): string {
  return [`Spinosa version: ${version}`, `OS: ${describeOS()}`, `Terminal: ${describeTerminal()}`].join("\n")
}

export function buildBugReportUrl(input: BugReportInput): URL {
  const version = input.version ?? InstallationVersion
  const message = sanitizeBlock(input.message)
  const stack = sanitizeBlock(input.stack)
  const recent = input.logs ?? collectRecentErrorLogs()
  const logs = [stack && `stack:\n${stack}`, recent && `recent:\n${recent}`].filter(Boolean).join("\n\n") || EMPTY_LOGS

  if (input.kind === "crash") {
    const title = capString(input.title ?? `[Bug]: TUI crash: ${message || "unexpected error"}`, 80)
    return fitUrl({
      title,
      summary: "The TUI crashed with an unexpected error.",
      steps: "The TUI crashed. Describe what you were doing if you can.",
      expected: "The TUI should stay running.",
      actual: message || "An unknown error occurred.",
      environment: environmentBlock(version),
      logs,
    })
  }

  return fitUrl({
    title: capString(input.title ?? "[Bug]: ", 80),
    environment: environmentBlock(version),
    logs,
  })
}

export async function openBugReport(
  url: URL,
  options?: {
    openUrl?: (href: string) => Promise<unknown>
    writeClipboard?: (text: string) => Promise<void>
  },
): Promise<OpenBugReportResult> {
  const href = url.toString()
  const openUrl = options?.openUrl ?? ((target: string) => open(target))
  let opened = false
  try {
    await openUrl(href)
    opened = true
  } catch {
    opened = false
  }

  let copied = false
  if (options?.writeClipboard) {
    try {
      await options.writeClipboard(href)
      copied = true
    } catch {
      copied = false
    }
  }

  if (opened) return "opened"
  if (copied) return "copied"
  return "failed"
}

export async function reportBugFromTui(options: {
  confirm: () => Promise<boolean | undefined>
  showToast: (input: { variant: "success" | "info" | "error"; message: string }) => void
  openUrl?: (href: string) => Promise<unknown>
  writeClipboard?: (text: string) => Promise<void>
  logs?: string
}): Promise<OpenBugReportResult | "cancelled"> {
  const confirmed = await options.confirm()
  if (!confirmed) return "cancelled"
  const url = buildBugReportUrl({ kind: "user", logs: options.logs })
  const result = await openBugReport(url, options)
  if (result === "opened") {
    options.showToast({
      variant: "success",
      message: "GitHub form opened. Submit on github.com/medialab/spinosa to file the issue.",
    })
  } else if (result === "copied") {
    options.showToast({
      variant: "info",
      message: "Could not open the browser. URL copied. Paste it, then Submit on GitHub.",
    })
  } else {
    options.showToast({
      variant: "error",
      message: "Could not open or copy the GitHub report URL.",
    })
  }
  return result
}
