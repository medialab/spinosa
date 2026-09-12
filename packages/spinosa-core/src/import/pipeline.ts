import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import * as path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { MarkItDown } from "@spinosa/markitdown"

import stripAnsi from "strip-ansi"
import { markitdownConvertFile } from "./markitdown-convert"
import { fileExt, IMAGE_EXTENSIONS, extInList } from "../constants"
import { TesseractLowConfidenceError } from "./tesseract-ocr"
import {
  shouldSkipSourceFile,
  findSourceFiles,
  markdownRawRelPath,
  markitdownOutputRelPath,
  ocrOutputRelPath,
  safeRelPaths,
  scanClassifySourceFile,
  importRouteForFile,
} from "../extension/classifier"
import { safeCopyAsync, writeTextAtomic, writeTextAtomicSafe } from "../utils/fs"
import { spinosaLogInfo, spinosaLogWarn } from "../utils/log"
import type { FileClass, ImportRoute } from "../extension/types"
import { injectColdFrontmatter, convertedOutputExists } from "./frontmatter"
import type { ImportBatchManager } from "./batch"
import { isSpinosaCancellationError, throwIfSpinosaCancelled, SpinosaCancellationError } from "./cancellation"
import { isVisionModelId } from "./vision-helpers"
import { ProgressEmitter, type FileProgressStatus } from "../progress/progress"
import { ocrAvailable, tesseractAvailable } from "../tools/detection"
import { ocrUnsupportedReason } from "../tools/ocr-support"
import { isCompiledBinaryDistribution } from "../distribution/bootstrap"
import { decodeWorkerPayload, disposeWorkerPayload, encodeWorkerPayload } from "./worker-payload"
import { terminateChild } from "../progress/child-kill"
import { recordResult, manifestDest, manifestPath, reconcileManifest, loadManifest, pruneManifest, type ManifestStatus, type ManifestRecord } from "./manifest"

// ── Phase-result manifest recording ─────────────────────────────────────
// Every terminal file state lands in <workspace>/.logs/import-manifest.ndjson
// so resume runs skip done files, re-process changed ones, and retry failed
// ones — without relying on output existence alone.
function recordPhaseResult(
  logsDir: string | undefined,
  f: ClassifiedEntry,
  route: string,
  status: ManifestStatus,
  engine: string,
  model?: string,
  attempts?: number,
): void {
  if (!logsDir) return
  recordResult({
    logsDir, rel: f.rel, ext: fileExt(f.src), route, status,
    srcFile: f.src, dest: manifestDest(logsDir, f.dest), engine, model, attempts,
  })
}

/** Buckets handed to applyResumeFilter (vision/copy buckets optional). */
export type ResumeBuckets = {
  directFiles: ClassifiedEntry[]
  markitdownFiles: ClassifiedEntry[]
  visionFiles?: ClassifiedEntry[]
  ocrFiles: ClassifiedEntry[]
  copyFiles?: ClassifiedEntry[]
}

export type ResumeFilterResult = {
  skippedUnchanged: string[]
  changed: string[]
  rerouted: string[]
  removedPruned: string[]
  retriedFailed: string[]
  untrackedNew: string[]
}

/**
 * Resume short-circuit: drop already-imported files from classified buckets
 * using the durable manifest, so re-runs don't re-process them. Returns the
 * resume accounting for UX. Rules:
 * - done + fingerprint match + same route (+ same vision model) → skip.
 * - fingerprint mismatch, route change, or vision-model change → re-process.
 * - failed/skipped records always retry (transient errors may pass).
 * - tracked-but-absent rels are pruned from the manifest file.
 * - overwrite runs bypass filtering (user asked to redo everything).
 * Mutates the passed buckets in place.
 */
export function applyResumeFilter(
  classified: ResumeBuckets,
  logsDir: string,
  opts?: {
    manifest?: Map<string, ManifestRecord>
    modelId?: string
    overwrite?: boolean
    onLog?: (msg: string) => void
  },
): ResumeFilterResult {
  const empty: ResumeFilterResult = {
    skippedUnchanged: [], changed: [], rerouted: [], removedPruned: [], retriedFailed: [], untrackedNew: [],
  }
  const bucketRoutes: Array<{ key: keyof ResumeBuckets; route: string }> = [
    { key: "directFiles", route: "direct" },
    { key: "markitdownFiles", route: "markitdown" },
    { key: "visionFiles", route: "vision" },
    { key: "ocrFiles", route: "ocr" },
    { key: "copyFiles", route: "copy" },
  ]
  const entries: Array<{ rel: string; srcFile: string; ext: string }> = []
  const relRoute = new Map<string, string>()
  const destByRel = new Map<string, string>()
  for (const { key, route } of bucketRoutes) {
    for (const f of classified[key] ?? []) {
      entries.push({ rel: f.rel, srcFile: f.src, ext: fileExt(f.src) })
      if (!relRoute.has(f.rel)) relRoute.set(f.rel, route)
      if (!destByRel.has(f.rel)) destByRel.set(f.rel, f.dest)
    }
  }
  const manifest = opts?.manifest ?? loadManifest(logsDir).records
  if (manifest.size > 0) {
    opts?.onLog?.(`Manifest: ${manifestPath(logsDir)} (${manifest.size} tracked files)`)
  }
  // Route/model drift: a done record under a different engine selection is
  // stale by definition (e.g. tesseract transcript exists, user now wants vision).
  const normModel = (id: string | undefined) => (id && isVisionModelId(id) ? id : "")
  const currentModel = normModel(opts?.modelId)
  // PDFs triaged to MarkItDown (route "markitdown") and PDFs extracted via
  // the OCR digital path (route "ocr") deliver the SAME dest rel
  // (markitdownOutputRelPath === ocrOutputRelPath), so ocr↔markitdown drift
  // on a .pdf is not a real route change — re-processing it every run would
  // never settle. Vision/copy stay distinct (different engines/selections).
  const normRoute = (route: string | undefined, rel: string) => {
    if (route === "ocr" || route === "markitdown") {
      if (fileExt(rel).toLowerCase() === "pdf") return "pdf-text"
    }
    return route ?? ""
  }
  const rerouted: string[] = []
  for (const [rel, route] of relRoute) {
    const record = manifest.get(rel)
    if (!record || record.status !== "done") continue
    if (record.route && normRoute(record.route, rel) !== normRoute(route, rel)) {
      manifest.delete(rel)
      rerouted.push(rel)
      continue
    }
    // Vision-model drift only counts on explicit mismatch (both known).
    // Adopted records without a model never trigger and simply match.
    if (route === "vision" && record.model && currentModel && record.model !== currentModel) {
      manifest.delete(rel)
      rerouted.push(rel)
    }
  }
  if (opts?.overwrite) {
    const removed = [...manifest.keys()].filter((rel) => !relRoute.has(rel))
    const pruned = pruneManifest(logsDir, removed)
    opts?.onLog?.(`Resume bypassed (overwrite): re-processing everything${pruned > 0 ? `, pruned ${pruned} removed` : ""}`)
    return { ...empty, removedPruned: removed.slice(0, pruned) }
  }
  const reconciled = reconcileManifest(manifest, entries)
  // Manifest hit but output gone by hand → not actually done. Re-process
  // (verify would recover these too, but doing it here keeps one pass).
  const missingOutput: string[] = []
  const trulyUnchanged = reconciled.unchanged.filter((rel) => {
    const dest = destByRel.get(rel)
    if (dest && !convertedOutputExists(dest)) {
      missingOutput.push(rel)
      return false
    }
    return true
  })
  const skipSet = new Set(trulyUnchanged)
  for (const { key } of bucketRoutes) {
    const bucket = classified[key]
    if (!bucket) continue
    const kept = bucket.filter((f) => !skipSet.has(f.rel))
    bucket.length = 0
    bucket.push(...kept)
  }
  const prunedCount = pruneManifest(logsDir, reconciled.removed)
  const retriedFailed: string[] = []
  const untrackedNew: string[] = []
  for (const rel of reconciled.untracked) {
    const record = manifest.get(rel)
    if (record && (record.status === "failed" || record.status === "skipped")) retriedFailed.push(rel)
    else untrackedNew.push(rel)
  }
  const changed = [...reconciled.changed, ...rerouted]
  // Changed files must actually re-process: mark them so phase-level
  // exists-skips overwrite instead of skipping the stale dest.
  // (missingOutput needs no flag — with no dest, nothing skips it.)
  if (changed.length > 0) {
    const changedSet = new Set(changed)
    for (const { key } of bucketRoutes) {
      for (const f of classified[key] ?? []) {
        if (changedSet.has(f.rel)) f.force = true
      }
    }
  }
  const recovered = [...changed, ...missingOutput]
  const capList = (rels: string[]): string =>
    rels.length > 50 ? `${rels.slice(0, 50).join(", ")}, …+${rels.length - 50} more` : rels.join(", ")
  opts?.onLog?.(
    `Resume: ${trulyUnchanged.length} already imported (skipped) · ${recovered.length} changed (re-processing) · ${untrackedNew.length} new · ${reconciled.removed.length} removed (pruned) · ${retriedFailed.length} failed (retrying)`,
  )
  spinosaLogInfo(
    "resume",
    `skipped=[${capList(trulyUnchanged)}] changed=[${capList(changed)}] missing-output=[${capList(missingOutput)}] removed=[${capList(reconciled.removed)}] retry=[${capList(retriedFailed)}] new=[${capList(untrackedNew)}]`,
  )
  return {
    skippedUnchanged: trulyUnchanged,
    changed: recovered,
    rerouted,
    removedPruned: reconciled.removed.slice(0, prunedCount),
    retriedFailed,
    untrackedNew,
  }
}

export interface CopyResult {
  copied: number
  skipped: number
  failed: number
  mdConverted: number
  mdSkipped: number
  mdFailed: number
  ocrConverted: number
  ocrSkipped: number
  ocrFailed: number
  totalCopied: number
  stillMissing: number
  recovered: number
  failedFileCount: number
  failedFilePaths: string[]
}

export type ImportProgressCallback = (
  phase: string,
  current: number,
  total: number,
  relPath: string,
  status?: FileProgressStatus,
) => void

type CopyPhase = "all" | "direct" | "markitdown" | "vision" | "ocr"

interface CopyOptions {
  markitdownChoice?: boolean
  ocrChoice?: boolean
  runPhase?: CopyPhase
  verifyAfter?: boolean
  batchManager?: ImportBatchManager
  overwrite?: boolean
  subfolder?: string
  onProgress?: ImportProgressCallback
  onLog?: (line: string) => void
  onClassified?: (classified: { directFiles: ClassifiedEntry[]; markitdownFiles: ClassifiedEntry[]; visionFiles?: ClassifiedEntry[]; ocrFiles: ClassifiedEntry[]; copyFiles?: ClassifiedEntry[]; logsDir: string }) => void
  onPhaseChange?: (phase: string, message: string) => void
  shouldAbort?: () => boolean
  /** AbortSignal for immediate child cancel (preferred over shouldAbort polling). */
  signal?: AbortSignal
  /** Register MarkItDown/OCR worker children so CLI cancel can kill them. */
  onChild?: (child: ChildProcess) => void
  ocrModelId?: string
}



export interface PhaseResult {
  converted: number
  skipped: number
  failed: number
  renamed: number
  recoverable: { src: string; dest: string }[]
}

// ── Single-pass scan & classify ──────────────────────────────────────────

export interface ClassifiedEntry {
  src: string
  rel: string
  dest: string
  /** Resume: source changed (or re-routed) since the tracked run — phases must
      overwrite the existing dest instead of skipping it. */
  force?: boolean
}

async function isLegacyVisionModel(ocrModelId: string): Promise<boolean> {
  // Legacy short ids (no "/") resolve through the vision-models registry.
  if (ocrModelId.includes("/")) return false
  try {
    const { findOcrModel } = await import("./vision-models")
    return findOcrModel(ocrModelId)?.kind === "vision"
  } catch {
    return false
  }
}

export async function scanAndClassifySource(
  sourcePath: string,
  destDir: string,
  batchManager?: ImportBatchManager,
  subfolder?: string,
  shouldAbort?: () => boolean,
  ocrModelId?: string,
): Promise<{
  directFiles: ClassifiedEntry[]
  markitdownFiles: ClassifiedEntry[]
  visionFiles: ClassifiedEntry[]
  ocrFiles: ClassifiedEntry[]
  copyFiles: ClassifiedEntry[]
  logsDir: string
} | null> {
  const allFiles: string[] = []
  try {
    allFiles.push(...findSourceFiles(sourcePath, shouldAbort))
  } catch {
    return null
  }
  if (allFiles.length === 0) return null

  const entries: Array<{ filePath: string; relPath: string; ext: string; klass: FileClass }> = []
  for (const fp of allFiles) {
    throwIfSpinosaCancelled(shouldAbort)
    if (shouldSkipSourceFile(fp)) continue
    let rel = fp.replace(sourcePath, "").replace(/^\//, "")
    if (subfolder) rel = path.join(subfolder, rel)
    const ext = fileExt(fp)
    entries.push({ filePath: fp, relPath: rel, ext, klass: await scanClassifySourceFile(fp) })
    throwIfSpinosaCancelled(shouldAbort)
  }

  // Disambiguate across the WHOLE set: `safeRelPath` on each rel individually
  // cannot see its siblings, so `Report.txt`+`report.txt` (same dir, different
  // case) and truncation twins would silently collide on case-insensitive
  // volumes. Batch normalize with shared per-directory collision state.
  {
    const safeRels = safeRelPaths(entries.map((e) => e.relPath))
    for (let i = 0; i < entries.length; i++) entries[i]!.relPath = safeRels[i]!
  }

  // Log each file's classification for diagnostics
  for (const e of entries) {
    spinosaLogInfo("classify", `file=${e.relPath} ext=${e.ext} class=${e.klass}`)
  }
  // Log classification summary
  const markdown = entries.filter(e => e.klass === "markdown").length
  const native = entries.filter(e => e.klass === "native").length
  const md = entries.filter(e => e.klass === "markitdown").length
  const ocr = entries.filter(e => e.klass === "ocr_convertible").length
  const other = entries.filter(e => !["markdown", "native", "markitdown", "ocr_convertible"].includes(e.klass)).length
  spinosaLogInfo("classify", `summary: ${entries.length} total, ${native} native, ${markdown} markdown, ${md} markitdown, ${ocr} ocr_convertible, ${other} other`)

  const logsDir = path.resolve(destDir, "..", ".logs")
  mkdirSync(logsDir, { recursive: true })

  const directFiles: ClassifiedEntry[] = []
  const markitdownFiles: ClassifiedEntry[] = []
  const visionFiles: ClassifiedEntry[] = []
  const ocrFiles: ClassifiedEntry[] = []
  const copyFiles: ClassifiedEntry[] = []

  const filtered = (...klasses: FileClass[]) =>
    entries.filter(e => klasses.includes(e.klass) && isExtSelected(e.ext, batchManager))

  for (const e of filtered("markdown")) {
    directFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, markdownRawRelPath(e.relPath)) })
  }
  for (const e of filtered("native")) {
    directFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, e.relPath) })
  }
  for (const e of filtered("audio", "video")) {
    directFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, e.relPath) })
  }
  for (const e of filtered("binary_copyable")) {
    directFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, e.relPath) })
  }
  for (const e of filtered("markitdown")) {
    markitdownFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, markitdownOutputRelPath(e.relPath)) })
  }
  for (const e of filtered("ocr_convertible")) {
    if (extInList(e.ext, IMAGE_EXTENSIONS)) {
      // Images: with a vision model → dedicated vision SDK transcription;
      // otherwise copied as-is. "none" also copies.
      // MarkItDown handles office docs only, never images.
      let routeVision = false
      if (ocrModelId && isVisionModelId(ocrModelId)) {
        routeVision = true
      } else if (ocrModelId && !ocrModelId.includes("/")) {
        // Legacy short id (e.g. from vision-models registry)
        try {
          const { findOcrModel } = await import("./vision-models")
          routeVision = findOcrModel(ocrModelId)?.kind === "vision"
        } catch {}
      }
      if (routeVision) {
        visionFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, markitdownOutputRelPath(e.relPath)) })
        continue
      }
      copyFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, e.relPath) })
    } else {
      // PDFs: vision model → vision page transcription; "none" → copy as-is
      // (never OCR, never drop); tesseract (or legacy unset) → tesseract OCR,
      // which extracts digital PDFs via pdf.js before spending OCR.
      if (ocrModelId === "none") {
        copyFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, e.relPath) })
      } else if (ocrModelId && (isVisionModelId(ocrModelId) || await isLegacyVisionModel(ocrModelId))) {
        visionFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, markitdownOutputRelPath(e.relPath)) })
      } else {
        ocrFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, ocrOutputRelPath(e.relPath)) })
      }
    }
  }

  return { directFiles, markitdownFiles, visionFiles, ocrFiles, copyFiles, logsDir }
}


// ── Phase runners (receive pre-classified file lists) ────────────────────

const DIRECT_COPY_CONCURRENCY = 8
const DIRECT_COPY_RETRY_DELAY_MS = 5_000
const DIRECT_COPY_MAX_RETRIES = 3

export async function processDirectCopy(
  files: ClassifiedEntry[],
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  overwrite?: boolean,
  shouldAbort?: () => boolean,
  onRetry?: (attempt: number, reason: string) => void,
  onRename?: (original: string, renamed: string) => void,
  logsDir?: string,
): Promise<PhaseResult> {
  let converted = 0; let skipped = 0; let failed = 0; let renamed = 0
  let permanentFailed = 0
  const recoverable: { src: string; dest: string }[] = []
  let completed = 0
  const total = files.length

  /** Emit progress then yield so the TUI can paint mid-batch (OCR-style). */
  const emitProgress = async (relPath: string, current: number, status: "processing" | "done" | "failed") => {
    prog?.file("direct-progress", current, total, relPath, status)
    await yieldToEL()
  }

  const tryCopy = async (entry: ClassifiedEntry, attempt: number): Promise<CopyDirectResult> => {
    // File-start: show which file is in flight before the copy finishes.
    // Numerator stays at completed so the bar never jumps ahead of real work.
    await emitProgress(entry.rel, completed, "processing")
    const { src, rel, dest } = entry
    return copyDirectRawFile(src, dest, rel, onLog, overwrite || entry.force, shouldAbort, (a, r) => onRetry?.(attempt || a, r), (o, rn) => { renamed++; onRename?.(o, rn) })
  }

  const handleResult = async (entry: ClassifiedEntry, result: CopyDirectResult, bucket: ClassifiedEntry[]) => {
    if (result === "failed-permanent") {
      // Doomed on arrival: paint the row red NOW (no retry rounds), so the
      // filename changes color the moment the failure is known — not after
      // backoff rounds or a later verification pass.
      completed++
      permanentFailed++
      await emitProgress(entry.rel, completed, "failed")
      recordPhaseResult(logsDir, entry, "direct", "failed", "direct")
      return
    }
    if (result === "failed") {
      // A failed copy is not counted yet — it is still retrying. It only
      // counts as processed once it either succeeds or exhausts retries.
      bucket.push(entry)
      return
    }
    completed++
    // Count a file as processed only when it reaches a terminal success, so
    // the numerator reflects the amount of work done (and the % can reach
    // 100% once every file has been resolved one way or another).
    await emitProgress(entry.rel, completed, "done")
    if (result === "copied") {
      converted++
      if (entry.dest.endsWith(".md")) injectColdFrontmatter(entry.dest)
      recoverable.push({ src: entry.src, dest: entry.dest })
      recordPhaseResult(logsDir, entry, "direct", "done", "direct")
    } else {
      skipped++
      recordPhaseResult(logsDir, entry, "direct", "done", "direct")
    }
  }

  // First pass: bounded-concurrency parallel fast attempts.
  const retryBucket: ClassifiedEntry[] = []
  const runChunk = async (chunk: ClassifiedEntry[]) => {
    await Promise.all(chunk.map(async (entry) => {
      throwIfSpinosaCancelled(shouldAbort)
      const result = await tryCopy(entry, 0)
      await handleResult(entry, result, retryBucket)
    }))
  }

  for (let i = 0; i < files.length; i += DIRECT_COPY_CONCURRENCY) {
    if (shouldAbort?.()) break
    await runChunk(files.slice(i, i + DIRECT_COPY_CONCURRENCY))
  }

  // Retry bucket: backoff between rounds, then drop remaining as errors.
  for (let attempt = 1; attempt <= DIRECT_COPY_MAX_RETRIES && retryBucket.length > 0; attempt++) {
    if (shouldAbort?.()) break
    await new Promise((r) => setTimeout(r, DIRECT_COPY_RETRY_DELAY_MS))
    const pending = retryBucket.splice(0, retryBucket.length)
    const stillFailing: ClassifiedEntry[] = []
    await Promise.all(pending.map(async (entry) => {
      throwIfSpinosaCancelled(shouldAbort)
      const result = await tryCopy(entry, attempt)
      await handleResult(entry, result, stillFailing)
    }))
    retryBucket.push(...stillFailing)
  }

  // Files that exhausted every retry are permanently failed. Count them as
  // processed so the progress numerator reaches the total and the bar hits
  // 100% (worked = successes + final failures), not stuck below it.
  for (const entry of retryBucket) {
    completed++
    await emitProgress(entry.rel, completed, "failed")
    recordPhaseResult(logsDir, entry, "direct", "failed", "direct", undefined, DIRECT_COPY_MAX_RETRIES + 1)
  }
  failed = permanentFailed + retryBucket.length
  return { converted, skipped, failed, renamed, recoverable }
}

export async function processImageCopy(
  files: ClassifiedEntry[],
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  overwrite?: boolean,
  shouldAbort?: () => boolean,
  logsDir?: string,
): Promise<PhaseResult> {
  let converted = 0; let skipped = 0; let failed = 0
  const recoverable: { src: string; dest: string }[] = []
  let processed = 0
  const total = files.length
  for (const entry of files) {
    throwIfSpinosaCancelled(shouldAbort)
    prog?.file("copy", processed, total, entry.rel, "processing")
    await new Promise<void>((r) => setTimeout(r, 0))
    if (existsSync(entry.dest) && !overwrite && !entry.force) {
      skipped++
      prog?.file("copy", ++processed, total, entry.rel, "done")
      onLog?.(`  ${entry.rel} → already exists, skipped (copy as-is, no OCR engine selected)`)
      recordPhaseResult(logsDir, entry, "copy", "done", "copy")
      continue
    }
    const ok = await safeCopyAsync(entry.src, entry.dest, {
      shouldAbort,
      onRetry: (attempt, reason) => onLog?.(`  ${entry.rel} → retry ${attempt} (${reason})`),
      onRename: () => onLog?.(`  ${entry.rel} → renamed (name too long)`),
    })
    if (ok) {
      converted++
      recoverable.push({ src: entry.src, dest: entry.dest })
      prog?.file("copy", ++processed, total, entry.rel, "done")
      onLog?.(`  ${entry.rel} → copied as-is (no OCR engine selected)`)
      recordPhaseResult(logsDir, entry, "copy", "done", "copy")
    } else {
      failed++
      prog?.file("copy", ++processed, total, entry.rel, "failed")
      onLog?.(`  ${entry.rel} → copy failed`)
      recordPhaseResult(logsDir, entry, "copy", "failed", "copy")
    }
  }
  return { converted, skipped, failed, renamed: 0, recoverable }
}

export type MarkitdownHooks = {
  onChild?: (child: ChildProcess) => void
  /** AbortSignal for immediate child cancel (preferred over shouldAbort polling). */
  signal?: AbortSignal
  /** Nested OCR: false inside MD worker so cancel kills the whole group. Default true. */
  ocrDetached?: boolean
  /** Force in-process (worker entry / tests). Default: spawn NDJSON child like OCR. */
  inProcess?: boolean
  /** Engine selection for PDFs ("tesseract-local", "none", vision id, legacy unset = tesseract). */
  ocrModelId?: string | (() => string)
  /** Deprecated: vision failure now handled in vision phase. */
  onVisionFailure?: (rel: string, modelId: string, error: string) => Promise<"retry" | "skip" | "abort">
}

/** In-process MarkItDown phase (used by the NDJSON child worker). */
export async function processMarkitdownInProcess(
  files: ClassifiedEntry[],
  logsDir: string,
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  shouldAbort?: () => boolean,
  hooks?: MarkitdownHooks,
): Promise<PhaseResult> {
  let converted = 0; let skipped = 0; let failed = 0
  const recoverable: { src: string; dest: string }[] = []
  // Monotonic count of files that have reached a terminal state (skip,
  // success, or failure). Drives the progress numerator so the bar reflects
  // the amount of work done and reaches 100% once every file is resolved.
  let processed = 0

  const preSkipped: ClassifiedEntry[] = []
  const toProcess: ClassifiedEntry[] = []
  for (const f of files) {
    if (convertedOutputExists(f.dest) && !f.force) { preSkipped.push(f) } else { toProcess.push(f) }
  }

  skipped += preSkipped.length
  const total = preSkipped.length + toProcess.length

  /** OCR-style: announce file, then advance numerator on terminal state; yield so TUI paints. */
  const emitStart = async (relPath: string) => {
    prog?.file("MarkItDown", processed, total, relPath, "processing")
    await yieldToEL()
  }
  const emitDone = async (relPath: string, status: "done" | "failed" = "done") => {
    prog?.file("MarkItDown", ++processed, total, relPath, status)
    await yieldToEL()
  }

  for (const ps of preSkipped) {
    throwIfSpinosaCancelled(shouldAbort)
    await emitStart(ps.rel)
    onLog?.(`  ${ps.rel} → already converted, skipped`)
    appendNdjson(path.join(logsDir, "markitdown-processed.ndjson"), {
      ts: isoNow(), status: "skip", source: ps.rel,
      output: markitdownOutputRelPath(ps.rel),
      engine: "markitdown", pages: "", duration_s: 0,
    })
    // Adopt legacy outputs into tracking so resume knows them (and their
    // current fingerprint — a later edit re-processes).
    recordPhaseResult(logsDir, ps, "markitdown", "done", "markitdown")
    await emitDone(ps.rel)
  }

  const remainingMd = [...toProcess]

  const mdLog = path.join(logsDir, "markitdown-processed.ndjson")
  if (remainingMd.length > 0) {
    const converter = new MarkItDown()
    // MarkItDown handles office/docs only — PDFs extract via pdf.js and
    // transcribe via vision/OCR in the owning phase. Images are externalized
    // to vision-transcribe.ts (SDK path).
    // Vision model wiring removed; keep MarkItDown pure for docx/xlsx/epub/html etc.
    const INLINE_FORMATS = new Set(["json", "csv", "xml"])
    for (let _idx = 0; _idx < remainingMd.length; _idx++) {
      const f = remainingMd[_idx]!
      throwIfSpinosaCancelled(shouldAbort)
      const ext = fileExt(f.src).toLowerCase()

      if (INLINE_FORMATS.has(ext)) {
        await emitStart(f.rel)
        onLog?.(`  ${f.rel} → ${ext} ...`)
        const startTime = Date.now()
        try {
          const raw = readFileSync(f.src, "utf-8")
          throwIfSpinosaCancelled(shouldAbort)
          mkdirSync(path.dirname(f.dest), { recursive: true })
          const writtenDest = writeTextAtomicSafe(f.dest, `# ${path.basename(f.rel)}\n\n\`\`\`${ext}\n${raw}\n\`\`\`\n`)
          // writeTextAtomicSafe may truncate ENAMETOOLONG dests: everything
          // downstream (frontmatter, recoverable, manifest) must use the
          // path actually written, not the requested one.
          f.dest = writtenDest
          injectColdFrontmatter(f.dest)
          converted++
          await emitDone(f.rel)
          recoverable.push({ src: f.src, dest: f.dest })
          recordPhaseResult(logsDir, f, "markitdown", "done", `inline-${ext}`)
          appendNdjson(mdLog, {
            ts: isoNow(), status: "ok", source: f.rel,
            output: markitdownOutputRelPath(f.rel),
            engine: `inline-${ext}`, pages: "",
            duration_s: (Date.now() - startTime) / 1000,
          })
        } catch (err) {
          if (isSpinosaCancellationError(err)) throw err
          const errMsg = err instanceof Error ? err.message : String(err)
          failed++
          await emitDone(f.rel, "failed")
          recordPhaseResult(logsDir, f, "markitdown", "failed", `inline-${ext}`)
          appendNdjson(mdLog, {
            ts: isoNow(), status: "fail", source: f.rel,
            output: markitdownOutputRelPath(f.rel),
            engine: `inline-${ext}`, pages: "",
            duration_s: (Date.now() - startTime) / 1000,
            error: errMsg,
          })
          onLog?.(`${ext} conversion failed: ${f.rel} — ${errMsg}`)
        }
        continue
      }

      await emitStart(f.rel)
      const isImage = extInList(ext, IMAGE_EXTENSIONS)
      if (isImage) {
        // Images should have been routed to vision phase; if any slip through, treat as failed
        // rather than invoking MarkItDown vision (now externalized). Log clearly.
        onLog?.(`  ${f.rel} → image routed to MarkItDown but vision is externalized — marking failed (will be handled by vision phase if selected)`)
        failed++
        await emitDone(f.rel, "failed")
        recordPhaseResult(logsDir, f, "markitdown", "failed", "markitdown-ts")
        appendNdjson(mdLog, {
          ts: isoNow(), status: "fail", source: f.rel,
          output: markitdownOutputRelPath(f.rel),
          engine: "markitdown-ts",
          duration_s: 0,
          error: "image vision externalized to SDK — route to vision phase",
        })
        continue
      }
      const isPdf = fileExt(f.src).toLowerCase() === "pdf"
      if (!isPdf) {
        onLog?.(`  ${f.rel} → markitdown-ts ...`)
        const startTime = Date.now()
        try {
          mkdirSync(path.dirname(f.dest), { recursive: true })
          const result = await markitdownConvertFile(converter, f.src)
          throwIfSpinosaCancelled(shouldAbort)
          const text = result?.markdown ?? ""
          if (!text.trim()) throw new Error("MarkItDown returned no content")
          f.dest = writeTextAtomicSafe(f.dest, text)
          injectColdFrontmatter(f.dest)
          converted++
          await emitDone(f.rel)
          recoverable.push({ src: f.src, dest: f.dest })
          recordPhaseResult(logsDir, f, "markitdown", "done", "markitdown-ts")
          appendNdjson(mdLog, {
            ts: isoNow(), status: "ok", source: f.rel,
            output: markitdownOutputRelPath(f.rel),
            engine: "markitdown-ts", pages: "",
            duration_s: (Date.now() - startTime) / 1000,
          })
        } catch (err) {
          if (isSpinosaCancellationError(err)) throw err
          const errMsg = err instanceof Error ? err.message : String(err)
          onLog?.(`MarkItDown failed: ${f.rel} — ${errMsg}`)
          failed++
          await emitDone(f.rel, "failed")
          recordPhaseResult(logsDir, f, "markitdown", "failed", "markitdown-ts")
          appendNdjson(mdLog, {
            ts: isoNow(), status: "fail", source: f.rel,
            output: markitdownOutputRelPath(f.rel),
            engine: "markitdown-ts", pages: "",
            duration_s: (Date.now() - startTime) / 1000,
            error: errMsg,
          })
        }
        continue
      }
      // ---- PDFs are not a MarkItDown input ----
      // Text pages extract via pdf.js and image pages transcribe via
      // vision/OCR in the owning phase (per-page hybrid). A PDF only lands
      // here through a stale bucket or a direct call — converting it would
      // silently drop image pages, so fail loudly instead.
      onLog?.(`  ${f.rel} → PDF skipped in MarkItDown phase (PDFs extract via pdf.js, image pages via vision/OCR) — re-run import to route it`)
      failed++
      await emitDone(f.rel, "failed")
      recordPhaseResult(logsDir, f, "markitdown", "failed", "markitdown-ts")
      appendNdjson(mdLog, {
        ts: isoNow(), status: "fail", source: f.rel,
        output: markitdownOutputRelPath(f.rel),
        engine: "markitdown-ts", pages: "",
        duration_s: 0,
        error: "PDFs are not MarkItDown inputs — route to vision/ocr/copy",
      })
      continue
    }
  }

  return { converted, skipped, failed, renamed: 0, recoverable }
}

/**
 * MarkItDown phase — same protocol as OCR: NDJSON child by default (cancel kills child).
 * Pass `hooks.inProcess: true` from the worker entry (or tests) to run inline.
 */
export async function processMarkitdown(
  files: ClassifiedEntry[],
  logsDir: string,
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  shouldAbort?: () => boolean,
  hooks?: MarkitdownHooks,
): Promise<PhaseResult> {
  // Vision is now externalized to dedicated SDK phase (vision-transcribe.ts).
  // MarkItDown stays office-docs only and always uses the worker protocol.
  if (hooks?.inProcess || process.env.SPINOSA_IMPORT_IN_PROCESS === "1") {
    return processMarkitdownInProcess(files, logsDir, prog, onLog, shouldAbort, {
      ...hooks,
      inProcess: true,
      ocrDetached: hooks?.ocrDetached ?? false,
    })
  }
  return runMarkitdownViaChild(files, logsDir, prog, onLog, shouldAbort, hooks)
}

export async function processOcr(
  files: ClassifiedEntry[],
  logsDir: string,
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  shouldAbort?: () => boolean,
  hooks?: { onChild?: (child: ChildProcess) => void; signal?: AbortSignal },
): Promise<PhaseResult> {
  throwIfSpinosaCancelled(shouldAbort)
  let converted = 0; let skipped = 0; let failed = 0
  const recoverable: { src: string; dest: string }[] = []
  // Monotonic count of files that have reached a terminal state (skip,
  // success, or failure). Drives the progress numerator so the bar reflects
  // the amount of work done and reaches 100% once every file is resolved.
  let processed = 0

  const toProcess: ClassifiedEntry[] = []
  const preSkipped: ClassifiedEntry[] = []
  for (const f of files) {
    if (convertedOutputExists(f.dest) && !f.force) { preSkipped.push(f) } else { toProcess.push(f) }
  }

  skipped += preSkipped.length
  const total = preSkipped.length + toProcess.length
  for (const [i, ps] of preSkipped.entries()) {
    throwIfSpinosaCancelled(shouldAbort)
    onLog?.(`  ${ps.rel} → already converted, skipped`)
    appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
      ts: isoNow(), status: "skip", source: ps.rel,
      output: ocrOutputRelPath(ps.rel),
      engine: "tesseract", pages: "", duration_s: 0,
    })
    recordPhaseResult(logsDir, ps, "ocr", "done", "tesseract")
    prog?.file("OCR", ++processed, total, ps.rel, "done")
  }

  // Pass 1 (no tesseract needed): digital PDFs carry an encoded text layer,
  // extracted directly via the bundled pdf.js census (no API key, no OCR
  // spend). Scanned/invalid PDFs collect into `remaining` for tesseract.
  // Images must never reach OCR — fail fast with a pointer to vision.
  const remaining: ClassifiedEntry[] = []
  for (const file of toProcess) {
    throwIfSpinosaCancelled(shouldAbort)
    const start = Date.now()
    prog?.file("OCR", processed, total, file.rel, "processing")
    await yieldToEL()
    const ext = fileExt(file.src).toLowerCase()
    // Images should have been split to copyFiles; if any slip through, treat as copy-fail not OCR
    if (extInList(ext, IMAGE_EXTENSIONS)) {
      const err = "image files are copy-only (no tesseract for images — pick a vision model to transcribe them)"
      failed++
      appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
        ts: isoNow(), status: "fail", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: "", duration_s: (Date.now() - start) / 1000, error: err,
      })
      onLog?.(`  ${file.rel} → ${err}`)
      prog?.file("OCR", ++processed, total, file.rel, "failed")
      recordPhaseResult(logsDir, file, "ocr", "failed", "tesseract")
      continue
    }
    if (ext !== "pdf") {
      const err = `unsupported OCR extension: ${ext}`
      failed++
      appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
        ts: isoNow(), status: "fail", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: "", duration_s: (Date.now() - start) / 1000, error: err,
      })
      onLog?.(`  ${file.rel} → ${err}`)
      prog?.file("OCR", ++processed, total, file.rel, "failed")
      recordPhaseResult(logsDir, file, "ocr", "failed", "tesseract")
      continue
    }
    // Encoded-text census + per-page hybrid: all-digital → direct extract;
    // mixed → direct text pages + tesseract on imageless pages only. Census
    // timeouts scale with file size (slow-to-parse never reads as no-text).
    let digitalDone = false
    try {
      {
        const { classifyPdfPages, hasEmbeddedTextPdfPages, isDigitalPdfPages } = await import("./pdf-pages")
        const classes = await classifyPdfPages(file.src)
        throwIfSpinosaCancelled(shouldAbort)
        if (isDigitalPdfPages(classes)) {
          file.dest = await convertTextPdf(file.src, file.dest, file.rel, shouldAbort, async (page, pageTotal) => {
            prog?.file("OCR", processed, total, `${file.rel} (page ${page}/${pageTotal})`, "processing")
            await yieldToEL()
          })
          throwIfSpinosaCancelled(shouldAbort)
          if (convertedOutputExists(file.dest)) {
            converted++
            recoverable.push({ src: file.src, dest: file.dest })
            appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
              ts: isoNow(), status: "ok", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "pdfjs", pages: "", duration_s: (Date.now() - start) / 1000,
            })
            onLog?.(`  ${file.rel} → digital PDF, text extracted via pdf.js (no OCR)`)
            prog?.file("OCR", ++processed, total, file.rel, "done")
            recordPhaseResult(logsDir, file, "ocr", "done", "pdfjs")
            digitalDone = true
          }
        } else if (hasEmbeddedTextPdfPages(classes)) {
          // Mixed: direct text pages + tesseract on imageless pages only.
          // All-image falls through to whole-file tesseract below (confidence
          // tracking + garbaged-image keeping live there, not in the hybrid).
          const { convertPdfHybridTesseract } = await import("./tesseract-ocr")
          const hybrid = await convertPdfHybridTesseract(file.src, file.dest, file.rel, classes, {
            shouldAbort,
            onLog,
            onPage: async (page, pageTotal) => {
              prog?.file("OCR", processed, total, `${file.rel} (page ${page}/${pageTotal})`, "processing")
              await yieldToEL()
            },
          })
          file.dest = hybrid.destFile
          throwIfSpinosaCancelled(shouldAbort)
          if (convertedOutputExists(file.dest)) {
            converted++
            recoverable.push({ src: file.src, dest: file.dest })
            appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
              ts: isoNow(), status: "ok", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "pdfjs+tesseract", pages: `${hybrid.ocrPages}/${hybrid.pages}`, duration_s: (Date.now() - start) / 1000,
            })
            onLog?.(`  ${file.rel} → mixed PDF, ${hybrid.pages - hybrid.ocrPages}/${hybrid.pages} pages direct + ${hybrid.ocrPages} via tesseract`)
            prog?.file("OCR", ++processed, total, file.rel, "done")
            recordPhaseResult(logsDir, file, "ocr", "done", "pdfjs+tesseract")
            digitalDone = true
          }
        }
      }
    } catch (err) {
      if (isSpinosaCancellationError(err)) throw err
      // fall through to tesseract below
    }
    if (!digitalDone) remaining.push(file)
  }

  // Pass 2: tesseract for scanned leftovers (ita+eng+fra, 300dpi) — only engine.
  // This phase only receives PDFs when Tesseract (or legacy unset) is the
  // selected engine — vision/none route elsewhere.
  if (tesseractAvailable() && remaining.length > 0) {
    const { ocrPdfViaTesseract } = await import("./tesseract-ocr")
    for (const file of remaining) {
      throwIfSpinosaCancelled(shouldAbort)
      const start = Date.now()
      prog?.file("OCR", processed, total, file.rel, "processing")
      await yieldToEL()
      try {
        const result = await ocrPdfViaTesseract(file.src, file.dest, file.rel, {
          shouldAbort,
          onLog,
          onPage: async (page, pageTotal) => {
            prog?.file("OCR", processed, total, `${file.rel} (page ${page}/${pageTotal})`, "processing")
            await yieldToEL()
          },
        })
        throwIfSpinosaCancelled(shouldAbort)
        file.dest = result.mdPath
        if (convertedOutputExists(file.dest)) {
          converted++
          recoverable.push({ src: file.src, dest: file.dest })
          appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
            ts: isoNow(), status: "ok", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: String(result.pages), duration_s: (Date.now() - start) / 1000,
          })
          onLog?.(`  ${file.rel} → tesseract OCR succeeded (${result.pages} pages)`)
          prog?.file("OCR", ++processed, total, file.rel, "done")
          recordPhaseResult(logsDir, file, "ocr", "done", "tesseract")
        } else {
          throw new Error("tesseract produced no output")
        }
      } catch (err) {
        if (isSpinosaCancellationError(err)) throw err
        if (err instanceof TesseractLowConfidenceError) {
          // Low confidence → discard garbled md, keep original as binary + placeholder md
          const binaryDest = path.join(path.dirname(file.dest), path.basename(file.src))
          try { rmSync(file.dest, { force: true }); rmSync(`${file.dest.slice(0, -3)}_pages`, { recursive: true, force: true }) } catch {}
          const copied = await safeCopyAsync(file.src, binaryDest)
          // Create placeholder md so raw has an entry and future verify doesn't loop
          const placeholder = [
            "---",
            `source_document: "${path.basename(file.rel).replace(/"/g, '\\"')}"`,
            `ocr_status: low_confidence`,
            `ocr_avg_conf: ${err.avgConf.toFixed(1)}`,
            `ocr_low_pct: ${err.lowPct.toFixed(1)}`,
            "---",
            "",
            `# ${path.basename(file.rel, path.extname(file.rel))} — OCR pending network`,
            "",
            `Original file kept as \`${path.basename(binaryDest)}\` pending network OCR (tesseract low confidence avg ${err.avgConf.toFixed(1)}, low ${err.lowPct.toFixed(1)}%).`,
            "",
            `> Garbled OCR discarded to avoid polluting raw.`,
            "",
          ].join("\n")
          try {
            mkdirSync(path.dirname(file.dest), { recursive: true })
            writeTextAtomicSafe(file.dest, placeholder)
            injectColdFrontmatter(file.dest)
          } catch {}
          if (copied) {
            onLog?.(`  ${file.rel} → tesseract low confidence (avg ${err.avgConf.toFixed(1)}, low ${err.lowPct.toFixed(1)}%) — keeping original ${path.basename(binaryDest)} + placeholder md`)
            // Placeholder only, no usable transcript → mark skipped so a
            // later resume retries instead of trusting the placeholder.
            recordPhaseResult(logsDir, file, "ocr", "skipped", "tesseract")
            appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
              ts: isoNow(), status: "skip", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: "", duration_s: (Date.now() - start) / 1000, error: `low confidence: ${err.message} — original kept`,
            })
            prog?.file("OCR", ++processed, total, file.rel, "done")
            skipped++
            continue
          }
        }
        const msg = err instanceof Error ? err.message : String(err)
        failed++
        appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
          ts: isoNow(), status: "fail", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: "", duration_s: (Date.now() - start) / 1000, error: msg,
        })
        onLog?.(`  ${file.rel} → tesseract failed: ${msg}`)
        prog?.file("OCR", ++processed, total, file.rel, "failed")
        recordPhaseResult(logsDir, file, "ocr", "failed", "tesseract")
      }
    }
    prog?.file("OCR", processed, total, "", "done")
    return { converted, skipped, failed, renamed: 0, recoverable }
  }

  if (remaining.length > 0 && !tesseractAvailable()) {
    const reason = ocrUnsupportedReason() ?? "OCR engine unavailable (tesseract missing)"
    onLog?.(`OCR unavailable: ${reason}`)
    for (const file of remaining) {
      throwIfSpinosaCancelled(shouldAbort)
      failed++
      appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
        ts: isoNow(),
        status: "fail",
        source: file.rel,
        output: ocrOutputRelPath(file.rel),
        engine: "tesseract",
        pages: "",
        duration_s: 0,
        error: reason,
      })
      onLog?.(`  ${file.rel} → OCR failed: ${reason}`)
      prog?.file("OCR", ++processed, total, file.rel, "failed")
      recordPhaseResult(logsDir, file, "ocr", "failed", "tesseract")
      await yieldToEL()
    }
    return { converted, skipped, failed, renamed: 0, recoverable }
  }

  // No ppu-paddle-ocr fallback — tesseract is the only OCR engine
  if (remaining.length > 0) {
    // Any remaining files after tesseract block are unexpected (e.g. tesseract not available already handled)
    // Mark them as failed with clear reason
    for (const file of remaining) {
      throwIfSpinosaCancelled(shouldAbort)
      failed++
      const err = "OCR failed: tesseract unavailable and no fallback"
      onLog?.(`  ${file.rel} → ${err}`)
      appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
        ts: isoNow(), status: "fail", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: "", duration_s: 0, error: err,
      })
      prog?.file("OCR", ++processed, total, file.rel, "failed")
      recordPhaseResult(logsDir, file, "ocr", "failed", "tesseract")
    }
    return { converted, skipped, failed, renamed: 0, recoverable }
  }

  return { converted, skipped, failed, renamed: 0, recoverable }
}

export type PdfPhaseHooks = {
  /** AbortSignal for immediate child cancel (tesseract spawns). */
  signal?: AbortSignal
  ocrModelId?: string | (() => string)
}

/**
 * Dedicated PDF step: every PDF lands here regardless of engine, so the TUI
 * shows one step for PDFs and vision keeps images only. Text pages extract
 * via pdf.js; image pages get tesseract transcription only when tesseract is
 * explicitly selected, otherwise an explicit placeholder (original kept for a
 * later vision pass). No vision calls are ever made here.
 */
export async function processPdf(
  files: ClassifiedEntry[],
  logsDir: string,
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  shouldAbort?: () => boolean,
  hooks?: PdfPhaseHooks,
): Promise<PhaseResult> {
  throwIfSpinosaCancelled(shouldAbort)
  let converted = 0
  let skipped = 0
  let failed = 0
  const recoverable: { src: string; dest: string }[] = []
  let processed = 0
  const total = files.length
  const pdfLog = path.join(logsDir, "pdf-processed.ndjson")

  const emitStart = async (relPath: string) => {
    prog?.file("PDF", processed, total, relPath, "processing")
    await yieldToEL()
  }
  const emitDone = async (relPath: string, status: "done" | "failed" = "done") => {
    prog?.file("PDF", ++processed, total, relPath, status)
    await yieldToEL()
  }
  const tickPdfPage = async (relPath: string, page: number, pageTotal: number) => {
    // Same live marker as vision: TUI renders "rel (PG: N/M)".
    prog?.file("PDF", processed, total, `${relPath} (page ${page}/${pageTotal})`, "processing")
    await yieldToEL()
  }

  const selectedOcrModelId =
    typeof hooks?.ocrModelId === "function" ? hooks.ocrModelId() : hooks?.ocrModelId
  // Manifest route mirrors scan routing so resume drift keeps working.
  const stepRoute = selectedOcrModelId === "none"
    ? undefined
    : selectedOcrModelId && selectedOcrModelId !== "tesseract-local" && isVisionModelId(selectedOcrModelId)
      ? "vision"
      : "ocr"
  const stepModel = typeof hooks?.ocrModelId === "string" ? hooks.ocrModelId : undefined
  // Tesseract fills image pages only when explicitly selected — never behind
  // the user's back under a vision selection.
  const useTesseract =
    (selectedOcrModelId === undefined || selectedOcrModelId === "tesseract-local") && tesseractAvailable()
  {
    const pdfJs = await import("../extension/pdf-js")
    const tesseractWhy = useTesseract
      ? "on"
      : selectedOcrModelId !== undefined && selectedOcrModelId !== "tesseract-local"
        ? `off (vision model selected: ${selectedOcrModelId} — image pages keep placeholders)`
        : "off (tesseract binary unavailable — image pages keep placeholders)"
    onLog?.(
      `PDF step: pdf.js-only text extraction ` +
        `(mainThreadHandler=${pdfJs.isPdfJsMainThreadHandlerPublished() ? "ready" : "MISSING — every PDF will fail"}, ` +
        `bundle=${isCompiledBinaryDistribution() ? "binary" : "source"}, ` +
        `selection=${selectedOcrModelId ?? "tesseract-local (default)"}, tesseractFill=${tesseractWhy})`,
    )
  }

  for (const f of files) {
    throwIfSpinosaCancelled(shouldAbort)
    if (fileExt(f.src).toLowerCase() !== "pdf") {
      onLog?.(`  ${f.rel} → not a PDF — PDF step cannot process it, failing (re-run import to route it)`)
      failed++
      await emitDone(f.rel, "failed")
      recordPhaseResult(logsDir, f, "pdf", "failed", "pdf-step")
      continue
    }
    if (stepRoute === undefined) {
      onLog?.(`  ${f.rel} → keep-as-is selection — copy, not PDF step (re-run import to route it)`)
      failed++
      await emitDone(f.rel, "failed")
      recordPhaseResult(logsDir, f, "pdf", "failed", "pdf-step")
      continue
    }
    await emitStart(f.rel)
    const startTime = Date.now()
    const title = path.basename(f.rel, path.extname(f.rel))
    // One pdf.js session: embedded text per page. Failed pages carry the
    // explicit gap marker through to the output — never silent.
    let pageTexts: Array<{ page: number; text: string }>
    let failedMarker: string
    let extractMs = 0
    try {
      const pdfJs = await import("../extension/pdf-js")
      failedMarker = pdfJs.PDF_TEXT_EXTRACTION_FAILED_MARKER
      const t0 = Date.now()
      pageTexts = await pdfJs.pdfExtractPageTexts(f.src)
      extractMs = Date.now() - t0
      throwIfSpinosaCancelled(shouldAbort)
    } catch (err) {
      if (isSpinosaCancellationError(err)) throw err
      const errMsg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error && err.stack
        ? `\n    stack: ${err.stack.split("\n").slice(0, 8).join("\n    ")}`
        : ""
      onLog?.(`  ${f.rel} → pdf.js could not open this file (${errMsg}) — failing (original kept in source)${stack}`)
      failed++
      await emitDone(f.rel, "failed")
      recordPhaseResult(logsDir, f, stepRoute, "failed", "pdfjs", stepModel)
      appendNdjson(pdfLog, {
        ts: isoNow(), status: "fail", source: f.rel,
        output: markitdownOutputRelPath(f.rel),
        engine: "pdfjs", pages: "", duration_s: (Date.now() - startTime) / 1000,
        error: errMsg,
        error_stack: err instanceof Error ? (err.stack ?? "") : "",
      })
      continue
    }
    const hasRealText = (text: string) =>
      text.trim().length > 0 && !text.includes(failedMarker)
    // Per-page outcome census: separates "parsed but blank" (scan/blanks)
    // from "parse failed" (marker) — the two look identical downstream.
    const directPages = pageTexts.filter(({ text }) => hasRealText(text))
    const failedPages = pageTexts.filter(({ text }) => text.includes(failedMarker))
    const blankPages = pageTexts.length - directPages.length - failedPages.length
    const textChars = directPages.reduce((n, { text }) => n + text.trim().length, 0)
    let srcBytes = 0
    try { srcBytes = statSync(f.src).size } catch {}
    onLog?.(
      `  ${f.rel} → pdf.js parsed ${pageTexts.length} pages in ${extractMs}ms ` +
        `(source ${srcBytes} bytes): ${directPages.length} with text (${textChars} chars), ` +
        `${blankPages} blank, ${failedPages.length} failed` +
        (failedPages.length > 0 ? ` [pages ${failedPages.map(({ page }) => page).join(",")}]` : ""),
    )
    if (!pageTexts.some(({ text }) => hasRealText(text))) {
      // Pure scan (or blanks): no transcript to write. Keep the original next
      // to a placeholder so a later vision pass can pick it up; mark skipped
      // so resume retries instead of trusting the placeholder.
      const binaryDest = path.join(path.dirname(f.dest), path.basename(f.src))
      try { rmSync(f.dest, { force: true }) } catch {}
      const copied = await safeCopyAsync(f.src, binaryDest)
      const placeholder = [
        "---",
        `source_document: "${path.basename(f.rel).replace(/"/g, '\\"')}"`,
        `pdf_status: no_extractable_text`,
        "---",
        "",
        `# ${title} — scan pending vision OCR`,
        "",
        `No text could be extracted with pdf.js (${pageTexts.length} pages).`,
        "",
        copied
          ? `Original kept as \`${path.basename(binaryDest)}\` pending vision OCR.`
          : `Original could not be kept (${path.basename(binaryDest)}).`,
        "",
      ].join("\n")
      try {
        mkdirSync(path.dirname(f.dest), { recursive: true })
        f.dest = writeTextAtomicSafe(f.dest, placeholder)
        injectColdFrontmatter(f.dest)
      } catch {}
      onLog?.(`  ${f.rel} → no extractable text — original kept as ${path.basename(binaryDest)}, pending vision OCR`)
      recordPhaseResult(logsDir, f, stepRoute, "skipped", "pdfjs", stepModel)
      appendNdjson(pdfLog, {
        ts: isoNow(), status: "skip", source: f.rel,
        output: markitdownOutputRelPath(f.rel),
        engine: "pdfjs", pages: String(pageTexts.length),
        duration_s: (Date.now() - startTime) / 1000,
        error: "no extractable text — original kept, pending vision OCR",
      })
      await emitDone(f.rel)
      skipped++
      continue
    }
    // Fill pages without real text via tesseract — only when selected.
    let filledViaTesseract = 0
    let texts = pageTexts
    const needEngine = pageTexts.filter(({ text }) => !hasRealText(text)).map(({ page }) => page)
    if (needEngine.length > 0 && useTesseract) {
      try {
        const { ocrPdfPagesViaTesseract } = await import("./tesseract-ocr")
        const ocr = await ocrPdfPagesViaTesseract(f.src, needEngine, f.rel, {
          shouldAbort,
          onLog,
          signal: hooks?.signal,
          pageTotal: pageTexts.length,
          onPage: (page, pageTotal) => tickPdfPage(f.rel, page, pageTotal),
        })
        throwIfSpinosaCancelled(shouldAbort)
        texts = pageTexts.map(({ page, text }) => {
          if (hasRealText(text)) return { page, text }
          const t = (ocr.get(page) ?? "").trim()
          if (t) filledViaTesseract++
          return { page, text: t || text }
        })
      } catch (err) {
        if (isSpinosaCancellationError(err)) throw err
        await failPdfFile(f, `tesseract page fill failed: ${err instanceof Error ? err.message : String(err)}`, err)
        continue
      }
    } else if (needEngine.length > 0) {
      onLog?.(`  ${f.rel} → ${needEngine.length}/${pageTexts.length} pages have no extractable text — placeholders kept (no engine selected for them)`)
    }
    try {
      mkdirSync(path.dirname(f.dest), { recursive: true })
      f.dest = await writePdfTextOutput(f.dest, title, f.rel, texts, (page, pageTotal) => tickPdfPage(f.rel, page, pageTotal), shouldAbort)
      throwIfSpinosaCancelled(shouldAbort)
      converted++
      const engineLabel = filledViaTesseract > 0 ? "pdfjs+tesseract" : "pdfjs"
      onLog?.(`  ${f.rel} → ${pageTexts.length - needEngine.length}/${pageTexts.length} pages direct via pdf.js${filledViaTesseract > 0 ? ` + ${filledViaTesseract} via tesseract` : ""}`)
      await emitDone(f.rel)
      recoverable.push({ src: f.src, dest: f.dest })
      recordPhaseResult(logsDir, f, stepRoute, "done", engineLabel, stepModel)
      appendNdjson(pdfLog, {
        ts: isoNow(), status: "ok", source: f.rel,
        output: markitdownOutputRelPath(f.rel),
        engine: engineLabel, pages: String(pageTexts.length),
        duration_s: (Date.now() - startTime) / 1000,
      })
    } catch (err) {
      if (isSpinosaCancellationError(err)) throw err
      await failPdfFile(f, `PDF write failed: ${err instanceof Error ? err.message : String(err)}`, err)
    }
  }
  return { converted, skipped, failed, renamed: 0, recoverable }

  async function failPdfFile(f: ClassifiedEntry, reason: string, err?: unknown): Promise<void> {
    failed++
    const stack = err instanceof Error && err.stack
      ? `\n    stack: ${err.stack.split("\n").slice(0, 8).join("\n    ")}`
      : ""
    onLog?.(`  ${f.rel} → ${reason}${stack}`)
    recordPhaseResult(logsDir, f, "pdf", "failed", "pdf-step")
    await emitDone(f.rel, "failed")
  }
}

export type OcrWorkerMode = "binary-cli" | "bun-script"

export function resolveOcrWorkerMode(workerScript = ""): OcrWorkerMode {
  if (isCompiledBinaryDistribution()) return "binary-cli"
  if (workerScript.includes("$bunfs")) return "binary-cli"
  const exe = path.basename(process.argv0 || process.execPath || "")
  if (exe === "spinosa" || exe.startsWith("spinosa-")) return "binary-cli"
  return "bun-script"
}

function bunExecutableForWorker(): string {
  const exec = process.execPath || ""
  if (/(^|\/)bun(\.exe)?$/i.test(exec)) return exec
  return "bun"
}

function productBinaryExecutable(): string {
  return process.execPath || process.argv0 || "spinosa"
}

// Back-compat alias for tests that still import the old ppu name
export const consumeOcrWorkerNdjsonLine = consumeMarkitdownWorkerNdjsonLine as unknown as (
  line: string,
  state: {
    workerConverted: number
    workerSkipped: number
    errors: string[]
    fileResults: Array<{ rel: string; ok: boolean; error?: string }>
    finishedRels: string[]
    inFlightRel?: string
  },
  options?: {
    onLog?: (msg: string) => void
    onProgress?: (current: number, total: number, relPath: string) => void
    onPageProgress?: (current: number, total: number, relPath: string, page: string) => void
    onFileStart?: (relPath: string) => void
    onFile?: (result: { rel: string; ok: boolean; error?: string }) => void
  },
) => void

function markitdownWorkerScriptPath(): string {
  return fileURLToPath(new URL("markitdown-worker.ts", import.meta.url))
}

export function resolveMarkitdownWorkerMode(workerScript = markitdownWorkerScriptPath()): OcrWorkerMode {
  return resolveOcrWorkerMode(workerScript)
}

type MarkitdownWorkerState = {
  converted: number
  skipped: number
  failed: number
  renamed: number
  recoverable: { src: string; dest: string }[]
  errors: string[]
}

export function consumeMarkitdownWorkerNdjsonLine(
  line: string,
  state: MarkitdownWorkerState,
  options?: {
    onLog?: (msg: string) => void
    onProgress?: (current: number, total: number, relPath: string, status?: string) => void
  },
): void {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const msg = JSON.parse(trimmed) as Record<string, unknown>
    switch (msg.type) {
      case "progress":
        options?.onProgress?.(
          Number(msg.current),
          Number(msg.total),
          String(msg.relPath ?? ""),
          typeof msg.status === "string" ? msg.status : undefined,
        )
        break
      case "log":
        options?.onLog?.(String(msg.message ?? ""))
        break
      case "done":
        state.converted = Number(msg.converted ?? 0)
        state.skipped = Number(msg.skipped ?? 0)
        state.failed = Number(msg.failed ?? 0)
        state.renamed = Number(msg.renamed ?? 0)
        if (Array.isArray(msg.recoverable)) {
          state.recoverable = (msg.recoverable as Array<{ src?: unknown; dest?: unknown }>)
            .filter((r) => typeof r?.src === "string" && typeof r?.dest === "string")
            .map((r) => ({ src: String(r.src), dest: String(r.dest) }))
        }
        if (Array.isArray(msg.errors)) {
          for (const e of msg.errors) state.errors.push(String(e))
        }
        break
      case "error":
        state.errors.push(String(msg.message ?? "worker error"))
        options?.onLog?.(`MarkItDown worker: ${msg.message}`)
        break
    }
  } catch {
    options?.onLog?.(`MarkItDown worker: ${trimmed}`)
  }
}

async function runMarkitdownViaChild(
  files: ClassifiedEntry[],
  logsDir: string,
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  shouldAbort?: () => boolean,
  hooks?: MarkitdownHooks,
): Promise<PhaseResult> {
  throwIfSpinosaCancelled(shouldAbort)
  const mode = resolveMarkitdownWorkerMode()
  const workerPayload = encodeWorkerPayload({ files, logsDir, ocrModelId: hooks?.ocrModelId })
  let child: ReturnType<typeof spawn>
  try {
    child =
      mode === "binary-cli"
        ? spawn(productBinaryExecutable(), ["internal", "markitdown-worker", workerPayload.arg], {
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
            env: process.env,
          })
        : spawn(bunExecutableForWorker(), ["run", markitdownWorkerScriptPath(), workerPayload.arg], {
            stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        })
  } catch (err) {
    // Spawn failure (missing bun/binary) must fail every file loudly — never
    // return zero counts that read as "nothing to do".
    disposeWorkerPayload(workerPayload.tempPath)
    const msg = `MarkItDown worker spawn failed: ${err instanceof Error ? err.message : String(err)}`
    onLog?.(msg)
    for (const f of files) {
      prog?.file("MarkItDown", 0, files.length, f.rel, "failed")
      recordPhaseResult(logsDir, f, "markitdown", "failed", "markitdown-worker")
    }
    return { converted: 0, skipped: 0, failed: files.length, renamed: 0, recoverable: [] }
  }

  hooks?.onChild?.(child)

  const state: MarkitdownWorkerState = {
    converted: 0,
    skipped: 0,
    failed: 0,
    renamed: 0,
    recoverable: [],
    errors: [],
  }

  let stdoutCarry = ""
  let stderrBuf = ""
  // Track rels that reached a terminal state via NDJSON progress so we can
  // reconcile any lost final `done`/`failed` events caused by stdout truncation.
  const terminalSeen = new Set<string>()
  const onProgress = (current: number, total: number, relPath: string, status?: string) => {
    const st =
      status === "queued" || status === "processing" || status === "done" || status === "failed" || status === "error"
        ? status
        : undefined
    if (st === "done" || st === "failed" || st === "error") {
      // Key matches applyImportProgressStatus stripping (arrow + page suffixes).
      const key = String(relPath).replace(/\s+→\s+.*$/, "").trim().replace(/\s+\(.*\)$/, "").trim()
      if (key) terminalSeen.add(key)
    }
    prog?.file("MarkItDown", current, total, relPath, st)
  }
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutCarry += chunk.toString()
    let nl: number
    while ((nl = stdoutCarry.indexOf("\n")) >= 0) {
      const line = stdoutCarry.slice(0, nl)
      stdoutCarry = stdoutCarry.slice(nl + 1)
      consumeMarkitdownWorkerNdjsonLine(line, state, { onLog, onProgress })
    }
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString()
  })

  const { code, signal, aborted, timedOut } = await waitForOcrChild(child, shouldAbort, hooks?.signal).finally(() =>
    disposeWorkerPayload(workerPayload.tempPath),
  )
  if (timedOut) {
    const msg = "MarkItDown worker timed out after 15m and was killed"
    state.errors.push(msg)
    onLog?.(msg)
  }
  if (stdoutCarry.trim()) consumeMarkitdownWorkerNdjsonLine(stdoutCarry, state, { onLog, onProgress })
  // Reconcile any files whose terminal progress was lost to truncation:
  // emit a synthetic terminal event so TUI's `Files (… pending)` does not leak
  // a stale `›` row (e.g. `survey-results.csv` stuck as processing).
  if (!aborted) {
    for (const f of files) {
      const key = String(f.rel).replace(/\s+→\s+.*$/, "").trim().replace(/\s+\(.*\)$/, "").trim()
      if (!key || terminalSeen.has(key)) continue
      const exists = (() => {
        try { return convertedOutputExists(f.dest) } catch { return false }
      })()
      const status = exists ? ("done" as const) : ("failed" as const)
      // Use total as current so bar can reach 100% even when last event was lost.
      onProgress(files.length, files.length, f.rel, status)
    }
  }

  try {
    child.unref()
  } catch {
    // ignore
  }

  if (aborted) {
    throw new SpinosaCancellationError("MarkItDown worker cancelled")
  }

  if (stderrBuf.trim()) {
    const errLine = stderrBuf.trim().split("\n").slice(-3).join(" | ")
    state.errors.push(errLine)
    onLog?.(`MarkItDown worker stderr: ${errLine}`)
  }

  if (signal) {
    const msg = `MarkItDown worker terminated by signal ${signal}`
    state.errors.push(msg)
    onLog?.(msg)
  } else if (code !== 0 && code !== null) {
    const msg = `MarkItDown worker exited with code ${code}`
    state.errors.push(msg)
    onLog?.(msg)
  }

  for (const err of state.errors) onLog?.(err)

  return {
    converted: state.converted,
    skipped: state.skipped,
    failed: state.failed,
    renamed: state.renamed,
    recoverable: state.recoverable,
  }
}

/**
 * Await child close, or terminate immediately when shouldAbort / AbortSignal flips.
 * If cancel already requested when `close` fires, finish as aborted (don't treat kill as crash).
 */
export async function waitForOcrChild(
  child: ChildProcess,
  shouldAbort?: () => boolean,
  signal?: AbortSignal,
  timeoutMs = 15 * 60 * 1000,
): Promise<{ code: number | null; signal: string | null; aborted: boolean; timedOut?: boolean }> {
  return new Promise((resolve) => {
    let settled = false
    let terminating = false
    const abortRequested = () => Boolean(shouldAbort?.() || signal?.aborted)

    const finish = (result: { code: number | null; signal: string | null; aborted: boolean; timedOut?: boolean }) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      if (signal) {
        try {
          signal.removeEventListener("abort", onAbortEvent)
        } catch {
          // ignore
        }
      }
      resolve(result)
    }

    const requestTerminate = (timedOut = false) => {
      if (settled || terminating) return
      terminating = true
      clearInterval(poll)
      void terminateChild(child).then(() => {
        finish({ code: null, signal: "SIGTERM", aborted: !timedOut, timedOut })
      })
    }

    const onAbortEvent = () => requestTerminate()

    child.on("close", (c, s) => {
      // Cancel kill often races the abort poll: treat as aborted if cancel already requested.
      finish({ code: c, signal: s, aborted: abortRequested() || terminating })
    })
    child.on("error", () => {
      finish({ code: 1, signal: null, aborted: abortRequested() || terminating })
    })

    const poll = setInterval(() => {
      if (!abortRequested()) return
      requestTerminate()
    }, 75)

    // Hung children must not wedge the queue forever: kill + report timeout.
    const timer = setTimeout(() => requestTerminate(true), timeoutMs)

    if (signal) {
      if (signal.aborted) requestTerminate()
      else signal.addEventListener("abort", onAbortEvent, { once: true })
    }

    // Immediate check in case abort was already requested via shouldAbort.
    if (abortRequested()) requestTerminate()
  })
}



// ── Helpers ───────────────────────────────────────────────────────────────

function isoNow(): string {
  return new Date().toISOString()
}

function yieldToEL(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  return promise
}

function isExtSelected(ext: string, bm?: ImportBatchManager): boolean {
  return !bm || bm.isSelected(ext)
}

function expectedImportDestRel(
  sourceRoot: string,
  srcFile: string,
  route: ImportRoute,
  safeRelPath?: string,
  subfolder?: string,
): string | undefined {
  const sourceRel = safeRelPath ?? srcFile.replace(sourceRoot, "").replace(/^\//, "")
  const rel = subfolder ? path.join(subfolder, sourceRel) : sourceRel
  switch (route) {
    case "markdown_rename":
      return markdownRawRelPath(rel)
    case "native_copy":
    case "media_copy":
    case "binary_copy":
    case "copy":
      return rel
    case "markitdown":
      return markitdownOutputRelPath(rel)
    case "vision":
      // Vision transcripts land next to MarkItDown output (doc__pdf.md).
      return markitdownOutputRelPath(rel)
    case "ocr":
      return ocrOutputRelPath(rel)
    default:
      return undefined
  }
}

function importOutputExists(destDir: string, relDest: string): boolean {
  return convertedOutputExists(path.join(destDir, relDest))
}

interface VerifyResult {
  missing: number
  recovered: number
  stillMissing: number
  missingFiles: string[]
  recoveredFiles: string[]
  stillMissingFiles: string[]
}


function appendNdjson(path: string, obj: Record<string, unknown>): void {
  appendFileSync(path, JSON.stringify(obj) + "\n", "utf-8")
}

/** Digital PDF → Markdown via bundled pdf.js (no OCR engine needed). Exported for single-file add. Returns the path actually written (truncation-safe). */
export async function convertTextPdf(
  srcFile: string,
  destFile: string,
  relPath: string,
  shouldAbort?: () => boolean,
  onPage?: (page: number, total: number) => void | Promise<void>,
): Promise<string> {
  const title = path.basename(relPath, path.extname(relPath))
  const { PDF_TEXT_EXTRACTION_FAILED_MARKER, pdfExtractPageTexts } = await import("../extension/pdf-js")
  const pageTexts = await pdfExtractPageTexts(srcFile)
  throwIfSpinosaCancelled(shouldAbort)
  if (pageTexts.some(({ text }) => text.includes(PDF_TEXT_EXTRACTION_FAILED_MARKER))) {
    throw new Error("pdf.js failed to extract one or more pages")
  }

  return writePdfTextOutput(destFile, title, relPath, pageTexts, onPage, shouldAbort)
}

/**
 * Write per-page texts as index + splits (same shape everywhere PDFs land).
 * Returns the index path actually written (truncation-safe). Failed-marker
 * page texts pass through verbatim so gaps stay explicit, never silent.
 */
export async function writePdfTextOutput(
  destFile: string,
  title: string,
  relPath: string,
  pageTexts: ReadonlyArray<{ page: number; text: string }>,
  onPage?: (page: number, total: number) => void | Promise<void>,
  shouldAbort?: () => boolean,
): Promise<string> {
  const pages = pageTexts.length

  if (pages === 1) {
    mkdirSync(path.dirname(destFile), { recursive: true })
    const actualDest = writeTextAtomicSafe(destFile, `# ${title}\n\n${pageTexts[0]!.text.trim() || "[No text extracted]"}\n`)
    injectColdFrontmatter(actualDest)
    await onPage?.(1, 1)
    return actualDest
  }

  const pageDir = destFile.endsWith(".md") ? destFile.slice(0, -3) : `${destFile}_pages`
  rmSync(pageDir, { recursive: true, force: true })
  mkdirSync(pageDir, { recursive: true })
  for (const { page, text } of pageTexts) {
    throwIfSpinosaCancelled(shouldAbort)
    const pageFile = path.join(pageDir, `page-${String(page).padStart(3, "0")}.md`)
    writeTextAtomicSafe(
      pageFile,
      [
        "---",
        `source_document: "${path.basename(relPath).replace(/"/g, '\\"')}"`,
        `page: ${page}`,
        `page_count: ${pages}`,
        "---",
        "",
        `# ${title} - Page ${page}`,
        "",
        text.trim() || "[No text extracted on this page]",
        "",
      ].join("\n"),
    )
    injectColdFrontmatter(pageFile)
    await onPage?.(page, pages)
  }
  mkdirSync(path.dirname(destFile), { recursive: true })
  const indexBody = (dirBase: string): string =>
    `# ${title}\n\n${pageTexts.map(({ page }) => `- [Page ${page}](${dirBase}/page-${String(page).padStart(3, "0")}.md)`).join("\n")}\n`
  const actualDest = writeTextAtomicSafe(destFile, indexBody(path.basename(pageDir)))
  injectColdFrontmatter(actualDest)
  if (actualDest !== destFile) {
    // ENAMETOOLONG truncated the index: move the splits dir to match the
    // written stem and rewrite the index so links resolve (finding: truncated
    // outputs reported "no output" with stranded files).
    const actualPageDir = actualDest.endsWith(".md") ? actualDest.slice(0, -3) : `${actualDest}_pages`
    try {
      rmSync(actualPageDir, { recursive: true, force: true })
      renameSync(pageDir, actualPageDir)
      const rewritten = writeTextAtomicSafe(actualDest, indexBody(path.basename(actualPageDir)))
      injectColdFrontmatter(rewritten)
      return rewritten
    } catch {
      // Splits stay under the requested dir; the index still converts.
      return actualDest
    }
  }
  return actualDest
}

type CopyDirectResult = "copied" | "skipped" | "failed" | "failed-permanent"

async function copyDirectRawFile(
  srcFile: string,
  destFile: string,
  relPath: string,
  onLog?: (msg: string) => void,
  overwrite?: boolean,
  shouldAbort?: () => boolean,
  onRetry?: (attempt: number, reason: string) => void,
  onRename?: (original: string, renamed: string) => void,
): Promise<CopyDirectResult> {
  onLog?.(`  ${relPath}`)

  if (existsSync(destFile)) {
    if (!overwrite) {
      onLog?.(`  ${relPath} → skipped`)
      return "skipped"
    }
  }

  // Yield before copy so cancel/abort and UI listeners can run between files.
  await yieldToEL()
  throwIfSpinosaCancelled(shouldAbort)

  let renameAttempted = false
  let lastReason = ""
  if (await safeCopyAsync(srcFile, destFile, {
    shouldAbort,
    onRetry: (attempt, reason) => {
      lastReason = reason
      onLog?.(`  ${relPath} → retry ${attempt} (${reason})`)
      onRetry?.(attempt, reason)
    },
    onRename: (original, renamed) => {
      onLog?.(`  ${relPath} → renamed (name too long)`)
      onRename?.(original, renamed)
      renameAttempted = true
    },
  })) {
    onLog?.(`  ${relPath} → copied`)
    return "copied"
  }

  // Doomed paths must not burn 3 rounds of backoff: a name that stays too
  // long even after the truncate-rescue (or a vanished source) fails the
  // same way on every attempt, so report it terminally right away.
  if (renameAttempted && /ENAMETOOLONG/.test(lastReason)) {
    onLog?.(`  ${relPath} → failed, no retry (name too long even when truncated)`)
    return "failed-permanent"
  }

  return "failed"
}


// ── Verify & recover (full source-tree scan, route-aware) ──────────────────

export async function verifyAndRecoverImport(
  sourcePath: string,
  destDir: string,
  batchManager: ImportBatchManager | undefined,
  markitdownChoice: boolean | undefined,
  ocrChoice: boolean | undefined,
  onLog?: (msg: string) => void,
  shouldAbort?: () => boolean,
  failedFilesDir?: string,
  subfolder?: string,
  phase?: CopyPhase,
  ocrModelId?: string,
): Promise<VerifyResult> {
  let missing = 0
  let recovered = 0
  let stillMissing = 0
  const missingFiles: string[] = []
  const recoveredFiles: string[] = []
  const stillMissingFiles: string[] = []
  const stillMissingEntries: ClassifiedEntry[] = []

  onLog?.("Verify & recover: scanning source tree...")

  const sourceFiles = findSourceFiles(sourcePath, shouldAbort)
  const sourceFilesForRelPaths = sourceFiles.filter((srcFile) => !shouldSkipSourceFile(srcFile))
  const safeRelPathsForSources = safeRelPaths(
    sourceFilesForRelPaths.map((srcFile) => srcFile.replace(sourcePath, "").replace(/^\//, "")),
  )
  const safeRelBySource = new Map(
    sourceFilesForRelPaths.map((srcFile, index) => [srcFile, safeRelPathsForSources[index]!] as const),
  )

  for (const srcFile of sourceFiles) {
    throwIfSpinosaCancelled(shouldAbort)
    if (shouldSkipSourceFile(srcFile)) continue

    const ext = fileExt(srcFile)
    if (batchManager && !batchManager.isSelected(ext)) continue

    const route = await importRouteForFile(srcFile, {
      markitdownChoice: markitdownChoice ?? false,
      ocrChoice: ocrChoice ?? false,
      ocrModelId,
    })
    throwIfSpinosaCancelled(shouldAbort)
    if (!route) continue

    const routePhase = route === "markitdown" ? "markitdown" : route === "vision" ? "vision" : route === "ocr" ? "ocr" : "direct"
    // "copy" (image_pending / none) shares direct phase for verify filtering
    if (phase && phase !== "all" && routePhase !== phase) continue

    const sourceRel = safeRelBySource.get(srcFile) ?? srcFile.replace(sourcePath, "").replace(/^\//, "")
    const relPath = subfolder ? path.join(subfolder, sourceRel) : sourceRel
    const expectedRel = expectedImportDestRel(sourcePath, srcFile, route, sourceRel, subfolder)
    if (!expectedRel) continue

    if (importOutputExists(destDir, expectedRel)) continue

    missing++
    missingFiles.push(relPath)
    onLog?.(`  Missing: ${relPath} → expected ${expectedRel} (route=${route})`)

    const destFile = path.join(destDir, expectedRel)
    let ok = false
    // Truncation-safe recovery: converters return the path actually written;
    // keep it local per branch so existence checks hit the real file.
    let recoveredDest = destFile

    switch (route) {
      case "markdown_rename":
      case "native_copy":
      case "media_copy":
      case "binary_copy":
      case "copy": {
        mkdirSync(path.dirname(destFile), { recursive: true })
        if (await safeCopyAsync(srcFile, destFile)) {
          throwIfSpinosaCancelled(shouldAbort)
          if (destFile.endsWith(".md")) injectColdFrontmatter(destFile)
          if (route === "copy") onLog?.(`    Recovered (copy for network OCR): ${relPath}`)
          else onLog?.(`    Recovered (direct copy): ${relPath}`)
          ok = true
        }
        break
      }
      case "markitdown": {
        // Office/text docs only — PDFs never route here (vision/ocr/copy own
        // them with per-page handling). A PDF arriving anyway is stale input:
        // leave it missing so the ocr/vision/copy branch recovers it.
        if (fileExt(srcFile).toLowerCase() === "pdf") {
          onLog?.(`    Still missing (PDF is not a MarkItDown input — re-run import to route it): ${relPath}`)
          break
        }
        try {
          mkdirSync(path.dirname(destFile), { recursive: true })
          const converter = new MarkItDown()
          const result = await markitdownConvertFile(converter, srcFile)
          throwIfSpinosaCancelled(shouldAbort)
          const text = stripAnsi(result?.markdown ?? "")
          if (!text.trim()) throw new Error("MarkItDown returned no content")
          writeTextAtomicSafe(destFile, text)
          injectColdFrontmatter(destFile)
          onLog?.(`    Recovered (markitdown-ts): ${relPath}`)
          ok = true
        } catch (error) {
          if (isSpinosaCancellationError(error)) throw error
          const errorMessage = error instanceof Error ? error.message : String(error)
          onLog?.(`    Still missing (MarkItDown failed, no source-copy fallback): ${relPath} — ${errorMessage}`)
        }
        break
      }
      case "vision": {
        // Vision transcripts are never auto-retried here: no MarkItDown
        // recovery (it cannot transcribe images/scanned PDFs), no tesseract
        // recovery (the user did not select it), and no source-copy onto the
        // .md path (that poisons raw/ for agents). The source is preserved to
        // _failed_files below; re-running import recovers it.
        spinosaLogWarn("vision", `verify recover left missing ${relPath}: vision transcript absent, no auto-retry`)
        onLog?.(`    Still missing (vision transcript absent — re-run import to retry, no auto-retry): ${relPath}`)
        break
      }
      case "ocr": {
        let ocrConverted = 0
        let ocrError: string | undefined
        // Mirror processOcr: digital PDFs extract via pdf.js (no tesseract
        // needed); scanned PDFs retry tesseract. MarkItDown never handles PDFs.
        try {
          {
            mkdirSync(path.dirname(destFile), { recursive: true })
            const { classifyPdfPages, hasEmbeddedTextPdfPages, isDigitalPdfPages } = await import("./pdf-pages")
            const classes = await classifyPdfPages(srcFile)
            throwIfSpinosaCancelled(shouldAbort)
            if (isDigitalPdfPages(classes)) {
              recoveredDest = await convertTextPdf(srcFile, destFile, relPath, shouldAbort)
              throwIfSpinosaCancelled(shouldAbort)
              if (convertedOutputExists(recoveredDest)) {
                injectColdFrontmatter(recoveredDest)
                ocrConverted = 1
                onLog?.(`    Recovered (digital PDF via pdf.js): ${relPath}`)
              }
            } else if (hasEmbeddedTextPdfPages(classes)) {
              const { convertPdfHybridTesseract } = await import("./tesseract-ocr")
              const hybridVerify = await convertPdfHybridTesseract(srcFile, destFile, relPath, classes, { shouldAbort, onLog })
              recoveredDest = hybridVerify.destFile
              throwIfSpinosaCancelled(shouldAbort)
              if (convertedOutputExists(recoveredDest)) {
                injectColdFrontmatter(recoveredDest)
                ocrConverted = 1
                onLog?.(`    Recovered (mixed PDF, direct + tesseract hybrid): ${relPath}`)
              }
            }
          }
        } catch (err) {
          if (isSpinosaCancellationError(err)) throw err
          // fall through to tesseract retry
        }
        if (ocrConverted === 0 && tesseractAvailable()) {
          try {
            const { ocrPdfViaTesseract } = await import("./tesseract-ocr")
            const tessVerify = await ocrPdfViaTesseract(srcFile, destFile, relPath, { shouldAbort, onLog })
            recoveredDest = tessVerify.mdPath
            if (convertedOutputExists(recoveredDest)) ocrConverted = 1
            else ocrError = "tesseract produced no convertible markdown"
          } catch (err) {
            if (isSpinosaCancellationError(err)) throw err
            ocrError = err instanceof Error ? err.message : String(err)
            onLog?.(`    tesseract failed: ${ocrError}`)
          }
        } else if (ocrConverted === 0) {
          ocrError = ocrUnsupportedReason() ?? "OCR engine unavailable"
        }
        if (ocrConverted > 0 && convertedOutputExists(recoveredDest)) {
          injectColdFrontmatter(recoveredDest)
          onLog?.(`    Recovered (ocr retry): ${relPath}`)
          ok = true
        } else {
          // Never copy PDF/PNG/JPEG onto a `.md` path — that poisons raw/ for agents.
          spinosaLogWarn("ocr", `verify recover left missing ${relPath}: ${ocrError ?? "ocr failed"}`)
          onLog?.(`    Still missing (OCR failed, no source-copy fallback): ${relPath}${ocrError ? ` — ${ocrError}` : ""}`)
        }
        break
      }
    }

  if (ok) {
    recovered++
    recoveredFiles.push(relPath)
  } else {
    stillMissing++
    stillMissingFiles.push(relPath)
    stillMissingEntries.push({ src: srcFile, rel: relPath, dest: destFile })
    onLog?.(`    Still missing: ${relPath}`)
    }
  }

  onLog?.(`Verify & recover: ${missing} missing, ${recovered} recovered, ${stillMissing} still missing`)

  if (failedFilesDir && stillMissingEntries.length > 0) {
    await preserveFailedImportFiles(stillMissingEntries, failedFilesDir, onLog)
  }
  return { missing, recovered, stillMissing, missingFiles, recoveredFiles, stillMissingFiles }
}

export interface FailedImportFilesResult {
  failedFilePaths: string[]
  savedFilePaths: string[]
}

/** Preserve selected inputs whose expected import output is still missing. */
export async function preserveFailedImportFiles(
  entries: readonly ClassifiedEntry[],
  rawDir: string,
  onLog?: (message: string) => void,
): Promise<FailedImportFilesResult> {
  const failedFilePaths: string[] = []
  const savedFilePaths: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (seen.has(entry.rel) || convertedOutputExists(entry.dest)) continue
    seen.add(entry.rel)
    failedFilePaths.push(entry.rel)

    const failedPath = path.join(rawDir, "_failed_files", entry.rel)
    try {
      mkdirSync(path.dirname(failedPath), { recursive: true })
      if (await safeCopyAsync(entry.src, failedPath)) {
        savedFilePaths.push(entry.rel)
      } else {
        onLog?.(`Could not preserve failed file: ${entry.rel}`)
      }
    } catch (error) {
      onLog?.(
        `Could not preserve failed file ${entry.rel}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return { failedFilePaths, savedFilePaths }
}

// ── Main copy pipeline ────────────────────────────────────────────────────
export async function copySource(
  sourcePath: string,
  destDir: string,
  options?: CopyOptions,
): Promise<CopyResult> {
  const res: CopyResult = {
    copied: 0, skipped: 0, failed: 0,
    mdConverted: 0, mdSkipped: 0, mdFailed: 0,
    ocrConverted: 0, ocrSkipped: 0, ocrFailed: 0,
    totalCopied: 0, stillMissing: 0, recovered: 0,
    failedFileCount: 0, failedFilePaths: [],
  }

  throwIfSpinosaCancelled(options?.shouldAbort)
  const classified = await scanAndClassifySource(sourcePath, destDir, options?.batchManager, options?.subfolder, options?.shouldAbort, options?.ocrModelId)
  if (!classified) {
    options?.onLog?.(`Failed to scan source: ${sourcePath}`)
    return res
  }

  // Resume: drop already-imported files so re-runs only process what's new,
  // changed, re-routed, or previously failed. Manifest lives in logsDir.
  const rawModelId = options?.ocrModelId
  applyResumeFilter(classified, classified.logsDir, {
    modelId: typeof rawModelId === "string" ? rawModelId : undefined,
    overwrite: options?.overwrite,
    onLog: options?.onLog,
  })

  options?.onClassified?.({
    directFiles: classified.directFiles,
    markitdownFiles: classified.markitdownFiles,
    visionFiles: classified.visionFiles,
    ocrFiles: classified.ocrFiles,
    copyFiles: (classified as unknown as { copyFiles: ClassifiedEntry[] }).copyFiles ?? [],
    logsDir: classified.logsDir,
  })

  const prog = new ProgressEmitter()
  prog.on((e) => options?.onProgress?.(e.phase, e.current, e.total, e.relPath, e.status))
  let verifiedFailedFilePaths: string[] = []

  const runPhase = (p: "direct" | "markitdown" | "ocr"): boolean => {
    const rp = options?.runPhase ?? "all"
    return rp === "all" || rp === p
  }

  const copyFiles = (classified as unknown as { copyFiles: ClassifiedEntry[] }).copyFiles ?? []
  const visionFiles = classified.visionFiles ?? []
  if (visionFiles.length > 0) {
    // copySource has no vision transcribe callback (CLI path): never drop
    // these silently — preserve originals and let verify report them.
    options?.onLog?.(
      `Vision: ${visionFiles.length} file(s) need a vision model, which copySource cannot transcribe — preserving originals to _failed_files/`,
    )
    await preserveFailedImportFiles(visionFiles, destDir, options?.onLog)
  }
  const attemptedFiles = [
    ...(runPhase("direct") ? classified.directFiles : []),
    ...(runPhase("direct") ? copyFiles : []),
    ...(runPhase("markitdown") && options?.markitdownChoice ? classified.markitdownFiles : []),
    ...(runPhase("ocr") && options?.ocrChoice ? classified.ocrFiles : []),
  ]
  for (const entry of attemptedFiles) {
    prog.file("queue", 0, attemptedFiles.length, entry.rel, "queued")
  }

  if (runPhase("direct") && classified.directFiles.length > 0) {
    options?.onPhaseChange?.("direct", `Copying ${classified.directFiles.length} files...`)
    const dr = await processDirectCopy(classified.directFiles, prog, options?.onLog, options?.overwrite, options?.shouldAbort, undefined, undefined, classified.logsDir)
    res.copied += dr.converted; res.skipped += dr.skipped; res.failed += dr.failed
  }

  if (copyFiles.length > 0) {
    // Files kept as-is: no OCR engine selected for them ("none" or legacy).
    if (runPhase("direct")) {
      options?.onPhaseChange?.("direct", `Copying ${copyFiles.length} files as-is (no OCR)...`)
    }
    const cr = await processImageCopy(copyFiles, prog, options?.onLog, options?.overwrite, options?.shouldAbort, classified.logsDir)
    res.copied += cr.converted; res.skipped += cr.skipped; res.failed += cr.failed
  }

  if (runPhase("markitdown") && classified.markitdownFiles.length > 0 && options?.markitdownChoice) {
    const visionHint = options?.ocrModelId && options.ocrModelId.startsWith("openrouter/") ? ` (vision: ${options.ocrModelId})` : ""
    options?.onPhaseChange?.("markitdown", `Converting ${classified.markitdownFiles.length} files with MarkItDown${visionHint}...`)
      const mr = await processMarkitdown(classified.markitdownFiles, classified.logsDir, prog, options?.onLog, options?.shouldAbort, {
        onChild: options?.onChild,
        signal: options?.signal,
        ocrModelId: options?.ocrModelId,
      })
    res.mdConverted += mr.converted; res.mdSkipped += mr.skipped; res.mdFailed += mr.failed
  }

  if (runPhase("ocr") && classified.ocrFiles.length > 0 && options?.ocrChoice) {
    options?.onPhaseChange?.("ocr", `Processing ${classified.ocrFiles.length} OCR files...`)
      const or = await processOcr(classified.ocrFiles, classified.logsDir, prog, options?.onLog, options?.shouldAbort, {
        onChild: options?.onChild,
        signal: options?.signal,
      })
    res.ocrConverted += or.converted; res.ocrSkipped += or.skipped; res.ocrFailed += or.failed
  }

  res.totalCopied = res.copied + res.mdConverted + res.ocrConverted

  if (options?.verifyAfter !== false) {
    const verifyResult = await verifyAndRecoverImport(
      sourcePath,
      destDir,
      options?.batchManager,
      options?.markitdownChoice,
      options?.ocrChoice,
      options?.onLog,
      options?.shouldAbort,
      destDir,
      options?.subfolder,
      options?.runPhase,
      typeof options?.ocrModelId === "string" ? options.ocrModelId : undefined,
    )
    res.stillMissing = verifyResult.stillMissing
    res.recovered = verifyResult.recovered
    verifiedFailedFilePaths = verifyResult.stillMissingFiles
    const verificationFiles = [
      ...verifyResult.recoveredFiles.map((rel) => ({ rel, status: "done" as const })),
      ...verifyResult.stillMissingFiles.map((rel) => ({ rel, status: "failed" as const })),
    ]
    verificationFiles.forEach(({ rel, status }, index) => {
      options?.onProgress?.("verification", index + 1, verificationFiles.length, rel, status)
    })
  }

  options?.onLog?.(`Copy complete: ${res.totalCopied} total (${res.copied} direct, ${res.mdConverted} MarkItDown, ${res.ocrConverted} OCR), ${res.skipped} skipped, ${res.failed} failed, ${res.stillMissing} still missing`)

  const preserved = await preserveFailedImportFiles(attemptedFiles, destDir, options?.onLog)
  const failedFilePaths = new Set([...verifiedFailedFilePaths, ...preserved.failedFilePaths])
  res.failedFilePaths = [...failedFilePaths]
  res.failedFileCount = res.failedFilePaths.length
  res.failedFilePaths.forEach((rel, index) => {
    // A worker can exit before emitting its per-file terminal event. The
    // preservation pass is authoritative, so close that gap for API users.
    options?.onProgress?.("failure", index + 1, res.failedFilePaths.length, rel, "failed")
  })

  if (res.failedFileCount > 0) {
    options?.onLog?.(`${res.failedFileCount} failed file(s) copied to raw/_failed_files/ when possible`)
  }

  return res
}
