import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

export const IMPORT_MANIFEST_FILENAME = "import-manifest.ndjson"

export type ManifestStatus = "done" | "failed" | "skipped"

export type ManifestRecord = {
  rel: string
  ext: string
  route: string
  status: ManifestStatus
  /** Source bytes at record time (stat). */
  bytes: number
  /** Source mtime at record time (stat, ms). */
  mtimeMs: number
  /** Workspace-relative dest that was written (or attempted). */
  dest: string
  engine: string
  model?: string
  attempts: number
  updatedTs: string
}

export type ManifestScanEntry = {
  rel: string
  srcFile: string
  ext: string
}

export type ManifestReconcile = {
  /** Manifest hit, fingerprint matches, terminal done → skip. */
  unchanged: string[]
  /** Manifest hit but source changed → re-process. */
  changed: string[]
  /** In manifest but absent from scan → pruned. */
  removed: string[]
  /** New files + previous failures → process. */
  untracked: string[]
}

export function manifestPath(logsDir: string): string {
  return path.join(logsDir, IMPORT_MANIFEST_FILENAME)
}

/**
 * Workspace-stable dest for records: relative to the workspace root
 * (parent of logsDir), so records survive machine moves. Falls back to
 * the absolute path when dest escapes the workspace.
 */
export function manifestDest(logsDir: string, dest: string): string {
  try {
    const root = path.resolve(logsDir, "..")
    const rel = path.relative(root, dest)
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel
    return dest
  } catch {
    return dest
  }
}

function ensureLogsDir(logsDir: string): void {
  try {
    mkdirSync(logsDir, { recursive: true })
  } catch {}
}

/** Cheap identity: stat only, no content read. */
export function fingerprintSource(srcFile: string): { bytes: number; mtimeMs: number } | undefined {
  try {
    const stat = statSync(srcFile)
    if (!stat.isFile()) return undefined
    return { bytes: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return undefined
  }
}

function parseRecordLine(line: string): ManifestRecord | undefined {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (typeof obj.rel !== "string" || obj.rel.length === 0) return undefined
  if (obj.status !== "done" && obj.status !== "failed" && obj.status !== "skipped") return undefined
  if (typeof obj.bytes !== "number" || typeof obj.mtimeMs !== "number") return undefined
  return {
    rel: obj.rel,
    ext: typeof obj.ext === "string" ? obj.ext : "",
    route: typeof obj.route === "string" ? obj.route : "",
    status: obj.status,
    bytes: obj.bytes,
    mtimeMs: obj.mtimeMs,
    dest: typeof obj.dest === "string" ? obj.dest : "",
    engine: typeof obj.engine === "string" ? obj.engine : "",
    model: typeof obj.model === "string" ? obj.model : undefined,
    attempts: typeof obj.attempts === "number" ? obj.attempts : 1,
    updatedTs: typeof obj.updatedTs === "string" ? obj.updatedTs : "",
  }
}

/**
 * Load the manifest. Latest line per rel wins (append-only history).
 * Missing file → empty map. Corrupt lines are skipped, never fatal.
 */
export function loadManifest(logsDir: string): { records: Map<string, ManifestRecord>; corruptLines: number } {
  const records = new Map<string, ManifestRecord>()
  let corruptLines = 0
  const file = manifestPath(logsDir)
  if (!existsSync(file)) return { records, corruptLines }
  let text: string
  try {
    text = readFileSync(file, "utf-8")
  } catch {
    return { records, corruptLines }
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const record = parseRecordLine(trimmed)
    if (!record) {
      corruptLines++
      continue
    }
    records.set(record.rel, record)
  }
  return { records, corruptLines }
}

/** Append one terminal-state record. Fire-and-forget: never throws. */
export function recordResult(entry: {
  logsDir: string
  rel: string
  ext: string
  route: string
  status: ManifestStatus
  srcFile: string
  dest: string
  engine: string
  model?: string
  attempts?: number
}): void {
  const { logsDir } = entry
  try {
    ensureLogsDir(logsDir)
    const fp = fingerprintSource(entry.srcFile)
    const record: ManifestRecord = {
      rel: entry.rel,
      ext: entry.ext,
      route: entry.route,
      status: entry.status,
      bytes: fp?.bytes ?? -1,
      mtimeMs: fp?.mtimeMs ?? -1,
      dest: entry.dest,
      engine: entry.engine,
      model: entry.model,
      attempts: entry.attempts ?? 1,
      updatedTs: new Date().toISOString(),
    }
    appendFileSync(manifestPath(logsDir), JSON.stringify(record) + "\n", "utf-8")
  } catch {}
}

/**
 * Compare a fresh scan against the manifest.
 * - unchanged: done + fingerprint match → skip without re-processing.
 * - changed: fingerprint mismatch → re-process (stale outputs overwritten).
 * - removed: tracked but absent → caller prunes.
 * - untracked: new files AND previous failures (failures always retry).
 */
export function reconcileManifest(
  records: Map<string, ManifestRecord>,
  scan: ManifestScanEntry[],
): ManifestReconcile {
  const unchanged: string[] = []
  const changed: string[] = []
  const untracked: string[] = []
  const seen = new Set<string>()
  for (const entry of scan) {
    seen.add(entry.rel)
    const record = records.get(entry.rel)
    if (!record || record.status !== "done") {
      untracked.push(entry.rel)
      continue
    }
    const fp = fingerprintSource(entry.srcFile)
    if (!fp || fp.bytes !== record.bytes || fp.mtimeMs !== record.mtimeMs) {
      changed.push(entry.rel)
      continue
    }
    unchanged.push(entry.rel)
  }
  const removed: string[] = []
  for (const rel of records.keys()) {
    if (!seen.has(rel)) removed.push(rel)
  }
  return { unchanged, changed, removed, untracked }
}

/**
 * Drop removed rels from the manifest file (only rewrite path; everything
 * else appends). Returns the pruned count. Never throws.
 */
export function pruneManifest(logsDir: string, removeRels: readonly string[]): number {
  if (removeRels.length === 0) return 0
  try {
    const { records } = loadManifest(logsDir)
    const remove = new Set(removeRels)
    let pruned = 0
    for (const rel of remove) {
      if (records.delete(rel)) pruned++
    }
    const lines: string[] = []
    for (const record of records.values()) lines.push(JSON.stringify(record))
    ensureLogsDir(logsDir)
    writeFileSync(manifestPath(logsDir), lines.length > 0 ? lines.join("\n") + "\n" : "", "utf-8")
    return pruned
  } catch {
    return 0
  }
}
