import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

export const IMPORT_MANIFEST_FILENAME = "import-manifest.ndjson"

export type ManifestStatus = "done" | "partial" | "failed" | "skipped"

export type ManifestRecord = {
  rel: string
  ext: string
  route: string
  status: ManifestStatus
  /** Source bytes at record time (stat). */
  bytes: number
  /** Source mtime at record time (stat, ms). */
  mtimeMs: number
  /** Content digest (sha256 hex) — source identity for corpus integrity. */
  sha256?: string
  /** Workspace-relative dest that was written (or attempted). */
  dest: string
  engine: string
  model?: string
  attempts: number
  updatedTs: string
  /** Page-level state for PDFs: retry unresolved pages on resume. */
  pages?: number
  completedPages?: number[]
  pendingPages?: number[]
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

/** Content digest (sha256 hex) for long-term corpus integrity. One file read. */
export function hashSourceFile(srcFile: string): string | undefined {
  try {
    const hash = createHash("sha256")
    hash.update(readFileSync(srcFile))
    return hash.digest("hex")
  } catch {
    return undefined
  }
}

function parseStringArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined
  return [...(value as number[])]
}

function parseRecordLine(line: string): ManifestRecord | undefined {
  let obj: unknown
  try {
    obj = JSON.parse(line) as unknown
  } catch {
    return undefined
  }
  // Harden parsing: root must be an object, every required property validated.
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return undefined
  const rec = obj as Record<string, unknown>
  if (typeof rec.rel !== "string" || rec.rel.length === 0 || rec.rel.length > 4096) return undefined
  if (rec.rel.includes("\0") || path.isAbsolute(rec.rel) || rec.rel.split(path.sep).includes("..")) return undefined
  if (rec.status !== "done" && rec.status !== "partial" && rec.status !== "failed" && rec.status !== "skipped") return undefined
  if (typeof rec.bytes !== "number" || typeof rec.mtimeMs !== "number") return undefined
  if (rec.sha256 !== undefined && (typeof rec.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(rec.sha256))) return undefined
  if (rec.dest !== undefined && typeof rec.dest !== "string") return undefined
  if (rec.engine !== undefined && typeof rec.engine !== "string") return undefined
  if (rec.model !== undefined && typeof rec.model !== "string") return undefined
  if (rec.attempts !== undefined && typeof rec.attempts !== "number") return undefined
  const pages = rec.pages === undefined ? undefined : typeof rec.pages === "number" ? rec.pages : undefined
  if (rec.pages !== undefined && pages === undefined) return undefined
  const completedPages = rec.completedPages === undefined ? undefined : parseStringArray(rec.completedPages)
  if (rec.completedPages !== undefined && completedPages === undefined) return undefined
  const pendingPages = rec.pendingPages === undefined ? undefined : parseStringArray(rec.pendingPages)
  if (rec.pendingPages !== undefined && pendingPages === undefined) return undefined
  return {
    rel: rec.rel,
    ext: typeof rec.ext === "string" ? rec.ext : "",
    route: typeof rec.route === "string" ? rec.route : "",
    status: rec.status,
    bytes: rec.bytes,
    mtimeMs: rec.mtimeMs,
    sha256: rec.sha256 as string | undefined,
    dest: typeof rec.dest === "string" ? rec.dest : "",
    engine: typeof rec.engine === "string" ? rec.engine : "",
    model: typeof rec.model === "string" ? rec.model : undefined,
    attempts: typeof rec.attempts === "number" ? rec.attempts : 1,
    updatedTs: typeof rec.updatedTs === "string" ? rec.updatedTs : "",
    pages,
    completedPages,
    pendingPages,
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
  let lineCount = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    lineCount++
    const record = parseRecordLine(trimmed)
    if (!record) {
      corruptLines++
      continue
    }
    records.set(record.rel, record)
  }
  if (lineCount > records.size * 3 && records.size > 0) {
    try {
      const lines: string[] = []
      for (const record of records.values()) lines.push(JSON.stringify(record))
      writeFileSync(file, lines.length > 0 ? `${lines.join("\n")}\n` : "")
    } catch {}
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
  pages?: number
  completedPages?: number[]
  pendingPages?: number[]
}): void {
  const { logsDir } = entry
  try {
    ensureLogsDir(logsDir)
    const fp = fingerprintSource(entry.srcFile)
    // A file may only be marked done when all required content was processed:
    // partial (unresolved pages) never upgrades to done here.
    const status: ManifestStatus =
      entry.status === "done" && entry.pendingPages && entry.pendingPages.length > 0 ? "partial" : entry.status
    const record: ManifestRecord = {
      rel: entry.rel,
      ext: entry.ext,
      route: entry.route,
      status,
      bytes: fp?.bytes ?? -1,
      mtimeMs: fp?.mtimeMs ?? -1,
      dest: entry.dest,
      engine: entry.engine,
      model: entry.model,
      attempts: entry.attempts ?? 1,
      updatedTs: new Date().toISOString(),
      pages: entry.pages,
      completedPages: entry.completedPages,
      pendingPages: entry.pendingPages,
    }
    appendFileSync(manifestPath(logsDir), JSON.stringify(record) + "\n", "utf-8")
  } catch {}
}

/**
 * Compare a fresh scan against the manifest.
 * - unchanged: done + size/mtime match → skip.
 * - changed: fingerprint mismatch → re-process.
 * - removed: tracked but absent → caller prunes.
 * - untracked: new files + previous failures + partials + reroutes → process.
 * Retry forces actual processing for changed/failed/partial/rerouted/
 * engine-changed/model-changed; only unchanged successful files skip.
 */
export function reconcileManifest(
  records: Map<string, ManifestRecord>,
  scan: ManifestScanEntry[],
  options?: { route?: Map<string, string>; engine?: Map<string, string>; model?: Map<string, string | undefined> },
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
    // Reroute / engine / model changes force reprocessing.
    if (options?.route?.get(entry.rel) && options.route.get(entry.rel) !== record.route) {
      changed.push(entry.rel)
      continue
    }
    if (options?.engine?.get(entry.rel) && options.engine.get(entry.rel) !== record.engine) {
      changed.push(entry.rel)
      continue
    }
    const wantModel = options?.model?.get(entry.rel)
    if (wantModel !== undefined && wantModel !== record.model) {
      changed.push(entry.rel)
      continue
    }
    const fp = fingerprintSource(entry.srcFile)
    if (!fp || fp.bytes !== record.bytes || fp.mtimeMs !== record.mtimeMs) {
      changed.push(entry.rel)
      continue
    }
    // Size + mtime match is enough for resume. Re-hashing every unchanged
    // file would reread the whole corpus on each incremental import.
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
