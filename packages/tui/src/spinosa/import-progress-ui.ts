import { homedir } from "node:os"
import path from "node:path"
import type { FileProgressStatus } from "@spinosa/core/progress/progress"

export type ImportFileProgressItem = {
  rel: string
  status: FileProgressStatus
}

/** Product log dir: `$SPINOSA_HOME/logs` or `~/.spinosa/logs`. */
export function resolveSpinosaLogsDir(): string {
  return path.join(process.env.SPINOSA_HOME ?? path.join(homedir(), ".spinosa"), "logs")
}

/** Home-relative display form (`~/.spinosa/logs`) for wizard chrome. */
export function displaySpinosaLogsDir(logsDir = resolveSpinosaLogsDir()): string {
  const home = homedir()
  const normalized = logsDir.replace(/\\/g, "/")
  const homeNorm = home.replace(/\\/g, "/")
  if (normalized === homeNorm || normalized.startsWith(`${homeNorm}/`)) {
    return `~${normalized.slice(homeNorm.length)}`
  }
  return normalized
}

/** Short pointer when verify/done has failures or gaps — no verbose LogScrollbox dump. */
export function formatImportDetailLogHint(logsDirDisplay = displaySpinosaLogsDir()): string {
  return `Details saved in ${logsDirDisplay}/`
}

export function shouldShowImportDetailLogHint(opts: {
  failedCount?: number
  stillMissing?: number
}): boolean {
  return (opts.failedCount ?? 0) > 0 || (opts.stillMissing ?? 0) > 0
}


/** Basename only; ellipsis middle if still too long. */
export function shortImportFileName(relPath: string, maxLen = 36): string {
  const base = relPath.replace(/\\/g, "/").split("/").pop() || relPath
  if (base.length <= maxLen) return base
  if (maxLen < 8) return base.slice(0, maxLen)
  const head = Math.ceil((maxLen - 1) / 2)
  const tail = Math.floor((maxLen - 1) / 2)
  return `${base.slice(0, head)}…${base.slice(-tail)}`
}

/** Display a relative path while retaining enough directory context to disambiguate sources. */
export function displayImportFilePath(relPath: string, maxLen = 64): string {
  const normalized = relPath.replace(/\\/g, "/")
  if (normalized.length <= maxLen) return normalized
  if (maxLen < 8) return normalized.slice(0, maxLen)
  const head = Math.ceil((maxLen - 1) / 2)
  const tail = Math.floor((maxLen - 1) / 2)
  return `${normalized.slice(0, head)}…${normalized.slice(-tail)}`
}

export function statusAccentKey(
  status: FileProgressStatus,
): "muted" | "primary" | "success" | "error" | "warning" {
  switch (status) {
    case "queued":
      return "muted"
    case "processing":
      return "primary"
    case "done":
      return "success"
    case "failed":
    case "error":
      return "error"
    default:
      return "muted"
  }
}

export function statusGlyph(status: FileProgressStatus): string {
  switch (status) {
    case "queued":
      return "·"
    case "processing":
      return "›"
    case "done":
      return "✓"
    case "failed":
    case "error":
      return "✗"
    default:
      return "·"
  }
}

/**
 * Visible queue window: current processing first, then upcoming queued (max N).
 * Done items drop out so the list stays a short live window.
 */
export function selectImportQueueWindow(
  items: ImportFileProgressItem[],
  maxVisible = 4,
): ImportFileProgressItem[] {
  const processing = items.filter((i) => i.status === "processing")
  const queued = items.filter((i) => i.status === "queued")
  return [...processing, ...queued].slice(0, maxVisible)
}

export function selectImportFailedItems(items: ImportFileProgressItem[]): ImportFileProgressItem[] {
  return items.filter((i) => i.status === "failed" || i.status === "error")
}

export function selectImportSucceededItems(items: ImportFileProgressItem[]): ImportFileProgressItem[] {
  return items.filter((i) => i.status === "done")
}

export function isTerminalImportFileStatus(status: FileProgressStatus): boolean {
  return status === "done" || status === "failed" || status === "error"
}

export type ImportProgressCounts = {
  succeeded: number
  failed: number
  pending: number
}

export function countImportProgress(items: ImportFileProgressItem[]): ImportProgressCounts {
  let succeeded = 0
  let failed = 0
  let pending = 0
  for (const item of items) {
    if (item.status === "done") succeeded++
    else if (item.status === "failed" || item.status === "error") failed++
    else pending++
  }
  return { succeeded, failed, pending }
}

/**
 * Phase is complete only when every known file is terminal.
 * With a live file list: pending===0 (queued/processing must settle first).
 * Without files: fall back to current/total bar counters.
 */
export function isImportPhaseComplete(
  current: number,
  total: number,
  files?: ImportFileProgressItem[],
): boolean {
  if (files && files.length > 0) {
    return countImportProgress(files).pending === 0
  }
  return total > 0 && current >= total
}

/** Phase-aware past-tense verb from the status line when easy; else "succeeded". */
export function importPhaseVerb(statusHint?: string): "copied" | "converted" | "processed" | "succeeded" {
  const s = (statusHint ?? "").toLowerCase()
  if (s.includes("markitdown")) return "converted"
  if (s.includes("ocr")) return "processed"
  if (s.includes("cop") || s.includes("direct")) return "copied"
  return "succeeded"
}

export function formatImportPhaseRecap(counts: ImportProgressCounts, statusHint?: string): string {
  const verb = importPhaseVerb(statusHint)
  const parts = [`${counts.succeeded} ${verb}`, `${counts.failed} failed`]
  if (counts.pending > 0) parts.push(`${counts.pending} pending`)
  return parts.join(" · ")
}

/** Recap when only bar counters are known — never invent a failed count. */
export function formatImportPhaseRecapFromCounters(
  current: number,
  statusHint?: string,
): string {
  return `${current} ${importPhaseVerb(statusHint)}`
}

/**
 * Complete-state results order: failures first, then succeeded.
 * UI scrolls the full list (no hard “… +N more” truncation).
 */
export function selectImportResultsWindow(items: ImportFileProgressItem[]): ImportFileProgressItem[] {
  const failed = items.filter((i) => i.status === "failed" || i.status === "error")
  const done = items.filter((i) => i.status === "done")
  return [...failed, ...done]
}

export function applyImportProgressStatus(
  items: ImportFileProgressItem[],
  relPath: string,
  status: FileProgressStatus,
): ImportFileProgressItem[] {
  if (!relPath) return items
  // Strip derived suffixes like "file.pdf → OCR fallback" and page suffixes
  // like "file.pdf (page 2)" so phantom progress rows map to the original file
  // instead of leaking a new pending entry.
  const key = relPath.replace(/\s+→\s+.*$/, "").trim().replace(/\s+\(.*\)$/, "").trim()
  // Exact rel match only. Suffix/substring matching conflates distinct rows
  // (e.g. `apple/notes.txt` would also "end with" `pineapple/notes.txt`) and
  // can paint the wrong file done/failed.
  const idx = items.findIndex((i) => i.rel === key)
  if (idx >= 0) {
    const prev = items[idx]!
    // OCR worker progress ticks can arrive after onFile; never downgrade terminal rows.
    if (isTerminalImportFileStatus(prev.status) && !isTerminalImportFileStatus(status)) {
      return items
    }
    const next = items.slice()
    next[idx] = { ...prev, status }
    return next
  }
  return [...items, { rel: key, status }]
}

export function seedImportQueue(rels: string[]): ImportFileProgressItem[] {
  return rels.map((rel) => ({ rel, status: "queued" as const }))
}

/**
 * Terminal-step accent: never paint full success green when files failed
 * or verify left gaps (`stillMissing`).
 */
export function importOutcomeAccentKey(opts: {
  failedCount?: number
  stillMissing?: number
}): "success" | "warning" | "error" {
  const failed = opts.failedCount ?? 0
  const missing = opts.stillMissing ?? 0
  if (failed > 0) return "error"
  if (missing > 0) return "warning"
  return "success"
}

export function importOutcomeHeading(opts: {
  failedCount?: number
  stillMissing?: number
}): string {
  const key = importOutcomeAccentKey(opts)
  if (key === "error") return "● Import finished with failures"
  if (key === "warning") return "● Import finished with gaps"
  return "● Import complete"
}
