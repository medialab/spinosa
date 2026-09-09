import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import * as path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { MarkItDown } from "markitdown-ts"

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
import type { PpuOcrFile, PpuOcrBatchResult } from "./ppu-ocr"
import { ProgressEmitter, type FileProgressStatus } from "../progress/progress"
import { ocrAvailable, tesseractAvailable } from "../tools/detection"
import { ocrUnsupportedReason } from "../tools/ocr-support"
import { isCompiledBinaryDistribution } from "../distribution/bootstrap"
import { decodeWorkerPayload, disposeWorkerPayload, encodeWorkerPayload } from "./worker-payload"
import { terminateChild } from "../progress/child-kill"

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

type CopyPhase = "all" | "direct" | "markitdown" | "ocr"

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
  onClassified?: (classified: { directFiles: ClassifiedEntry[]; markitdownFiles: ClassifiedEntry[]; ocrFiles: ClassifiedEntry[]; copyFiles?: ClassifiedEntry[]; logsDir: string }) => void
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
      // Images: with vision model → MarkItDown vision (transcribe via LLM);
      // otherwise copy-only (pending network OCR).
      if (ocrModelId) {
        if (ocrModelId === "none") continue
        if (ocrModelId === "tesseract-local") {
          // fall through to copy
        } else if (ocrModelId.includes("/")) {
          // Dynamic provider/model (e.g. openrouter/... or anthropic/...) — treat as vision
          let isVision = true
          try {
            const { findOcrModel } = await import("./vision-models")
            const m = findOcrModel(ocrModelId)
            if (m) isVision = m.kind === "vision"
          } catch {}
          if (isVision) {
            markitdownFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, markitdownOutputRelPath(e.relPath)) })
            continue
          }
        } else {
          const { findOcrModel } = await import("./vision-models")
          const m = findOcrModel(ocrModelId)
          if (m?.kind === "vision") {
            markitdownFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, markitdownOutputRelPath(e.relPath)) })
            continue
          }
          if (m?.kind === "none") continue
        }
      }
      copyFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, e.relPath) })
    } else {
      ocrFiles.push({ src: e.filePath, rel: e.relPath, dest: path.join(destDir, ocrOutputRelPath(e.relPath)) })
    }
  }

  return { directFiles, markitdownFiles, ocrFiles, copyFiles, logsDir }
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
): Promise<PhaseResult> {
  let converted = 0; let skipped = 0; let failed = 0; let renamed = 0
  const recoverable: { src: string; dest: string }[] = []
  let completed = 0
  const total = files.length

  /** Emit progress then yield so the TUI can paint mid-batch (OCR-style). */
  const emitProgress = async (relPath: string, current: number, status: "processing" | "done" | "failed") => {
    prog?.file("direct-progress", current, total, relPath, status)
    await yieldToEL()
  }

  const tryCopy = async (entry: ClassifiedEntry, attempt: number): Promise<"copied" | "skipped" | "failed"> => {
    // File-start: show which file is in flight before the copy finishes.
    // Numerator stays at completed so the bar never jumps ahead of real work.
    await emitProgress(entry.rel, completed, "processing")
    const { src, rel, dest } = entry
    return copyDirectRawFile(src, dest, rel, onLog, overwrite, shouldAbort, (a, r) => onRetry?.(attempt || a, r), (o, rn) => { renamed++; onRename?.(o, rn) })
  }

  const handleResult = async (entry: ClassifiedEntry, result: "copied" | "skipped" | "failed", bucket: ClassifiedEntry[]) => {
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
    } else { skipped++ }
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
  }
  failed = retryBucket.length
  return { converted, skipped, failed, renamed, recoverable }
}

export async function processImageCopy(
  files: ClassifiedEntry[],
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  overwrite?: boolean,
  shouldAbort?: () => boolean,
): Promise<PhaseResult> {
  let converted = 0; let skipped = 0; let failed = 0
  const recoverable: { src: string; dest: string }[] = []
  let processed = 0
  const total = files.length
  for (const entry of files) {
    throwIfSpinosaCancelled(shouldAbort)
    prog?.file("copy", processed, total, entry.rel, "processing")
    await new Promise<void>((r) => setTimeout(r, 0))
    if (existsSync(entry.dest) && !overwrite) {
      skipped++
      prog?.file("copy", ++processed, total, entry.rel, "done")
      onLog?.(`  ${entry.rel} → already exists, skipped (pending network OCR)`)
      continue
    }
    const ok = await safeCopyAsync(entry.src, entry.dest, {
      onRetry: (attempt, reason) => onLog?.(`  ${entry.rel} → retry ${attempt} (${reason})`),
    })
    if (ok) {
      converted++
      recoverable.push({ src: entry.src, dest: entry.dest })
      prog?.file("copy", ++processed, total, entry.rel, "done")
      onLog?.(`  ${entry.rel} → copied for network OCR (pending)`)
    } else {
      failed++
      prog?.file("copy", ++processed, total, entry.rel, "failed")
      onLog?.(`  ${entry.rel} → copy failed`)
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
  /** Selected OCR/vision model id (e.g. tesseract-local, openrouter/qwen2.5-vl:free). When vision, images flow via MarkItDown llmModel. */
  ocrModelId?: string
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
    if (convertedOutputExists(f.dest)) { preSkipped.push(f) } else { toProcess.push(f) }
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
    await emitDone(ps.rel)
  }

  const pdfOcrFallback: ClassifiedEntry[] = []
  const remainingMd = [...toProcess]

  const mdLog = path.join(logsDir, "markitdown-processed.ndjson")
  if (remainingMd.length > 0) {
    const converter = new MarkItDown()
    // Vision model for images (and optionally scanned PDFs) via MarkItDown llmModel.
    // Created once per phase; falls back to undefined (EXIF-only / copy) when no key.
    let vision: { model: unknown; prompt: string; modelId: string } | undefined
    if (hooks?.ocrModelId && hooks.ocrModelId !== "tesseract-local" && hooks.ocrModelId !== "none") {
      const { findOcrModel, OCR_VISION_PROMPT, createVisionLanguageModel } = await import("./vision-models")
      const opt = findOcrModel(hooks.ocrModelId)
      const isVision = opt ? opt.kind === "vision" : hooks.ocrModelId.includes("/")
      if (isVision) {
        const created = await createVisionLanguageModel(hooks.ocrModelId)
        if (created?.model) vision = { model: created.model, prompt: OCR_VISION_PROMPT, modelId: created.modelId }
        else {
          const need = opt?.requiresKey ?? (hooks.ocrModelId.includes("openrouter") ? "OPENROUTER_API_KEY" : "provider key")
          onLog?.(`Vision model ${hooks.ocrModelId} unavailable (missing ${need}) — images will be skipped/copied`)
        }
      }
    }
    // Formats markitdown-ts doesn't handle — convert inline
    const INLINE_FORMATS = new Set(["json", "csv", "xml"])
    for (const f of remainingMd) {
      throwIfSpinosaCancelled(shouldAbort)
      const ext = fileExt(f.src).toLowerCase()

      // Inline conversion for formats markitdown-ts doesn't support
      if (INLINE_FORMATS.has(ext)) {
        await emitStart(f.rel)
        onLog?.(`  ${f.rel} → ${ext} ...`)
        const startTime = Date.now()
        try {
          const raw = readFileSync(f.src, "utf-8")
          throwIfSpinosaCancelled(shouldAbort)
          mkdirSync(path.dirname(f.dest), { recursive: true })
          writeTextAtomicSafe(f.dest, `# ${path.basename(f.rel)}\n\n\`\`\`${ext}\n${raw}\n\`\`\`\n`)
          injectColdFrontmatter(f.dest)
          converted++
          await emitDone(f.rel)
          recoverable.push({ src: f.src, dest: f.dest })
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
      if (isImage && !vision) {
        // Image routed to MarkItDown due to vision selection but no valid
        // LanguageModel (missing key / offline) — keep original as fallback copy
        // to `raw/<rel>` (not `__jpg.md`) so workspace isn't left gaps.
        const fallbackDest = path.join(path.dirname(f.dest), path.basename(f.src))
        try { mkdirSync(path.dirname(fallbackDest), { recursive: true }) } catch {}
        const ok = await safeCopyAsync(f.src, fallbackDest)
        if (ok) {
          converted++
          recoverable.push({ src: f.src, dest: fallbackDest })
          appendNdjson(mdLog, {
            ts: isoNow(), status: "ok", source: f.rel,
            output: path.basename(fallbackDest),
            engine: "image-copy-fallback", pages: "",
            duration_s: 0,
          })
          onLog?.(`  ${f.rel} → image copy fallback (vision key missing)`)
          await emitDone(f.rel)
        } else {
          failed++
          appendNdjson(mdLog, {
            ts: isoNow(), status: "fail", source: f.rel,
            output: markitdownOutputRelPath(f.rel),
            engine: "image-copy-fallback", pages: "",
            duration_s: 0,
            error: "copy fallback failed",
          })
          onLog?.(`  ${f.rel} → image copy fallback failed`)
          await emitDone(f.rel, "failed")
        }
        continue
      }
      onLog?.(`  ${f.rel} → markitdown-ts${isImage && vision ? ` (vision:${vision.modelId})` : ""} ...`)
      const startTime = Date.now()
      try {
        mkdirSync(path.dirname(f.dest), { recursive: true })
        const result = await markitdownConvertFile(
          converter,
          f.src,
          isImage && vision ? { llmModel: vision.model, llmPrompt: vision.prompt } : undefined,
        )
        throwIfSpinosaCancelled(shouldAbort)
        const text = result?.markdown ?? ""
        if (!text.trim()) throw new Error("MarkItDown returned no content")
        writeTextAtomicSafe(f.dest, text)
        injectColdFrontmatter(f.dest)
        converted++
        await emitDone(f.rel)
        recoverable.push({ src: f.src, dest: f.dest })
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
        if (fileExt(f.src) === "pdf") {
          pdfOcrFallback.push(f)
          // Do not emit a derived `rel → OCR fallback` progress entry — that
          // creates a phantom `processing` row (leaked pending) because
          // `applyImportProgressStatus` keys on exact `rel`. Fallback progress
          // is reported via the subsequent `emitStart(f.rel)` in the OCR loop;
          // the derived label is log-only.
          onLog?.(`  ${f.rel} → OCR fallback queued`)
          await yieldToEL()
        } else {
          failed++
          await emitDone(f.rel, "failed")
          appendNdjson(mdLog, {
            ts: isoNow(), status: "fail", source: f.rel,
            output: markitdownOutputRelPath(f.rel),
            engine: "markitdown-ts", pages: "",
            duration_s: (Date.now() - startTime) / 1000,
            error: errMsg,
          })
        }
      }
    }
  }

  // Recover PDFs that failed MarkItDown via OCR (tesseract primary, ppu fallback)
  if (pdfOcrFallback.length > 0) {
    onLog?.(`Falling back to OCR for ${pdfOcrFallback.length} PDF(s) that failed MarkItDown...`)
    for (const f of pdfOcrFallback) {
      throwIfSpinosaCancelled(shouldAbort)
      await emitStart(f.rel)
      const startTime = Date.now()
      let ok = false
      let fallbackEngine = "tesseract"
      try {
        if (tesseractAvailable()) {
          const { ocrPdfViaTesseract } = await import("./tesseract-ocr")
          await ocrPdfViaTesseract(f.src, f.dest, f.rel, { shouldAbort, onLog })
          ok = convertedOutputExists(f.dest)
          if (ok) {
            converted++
            recoverable.push({ src: f.src, dest: f.dest })
            onLog?.(`  ${f.rel} → tesseract OCR fallback succeeded`)
          } else {
            failed++
            const errDetail = "tesseract produced no convertible output"
            onLog?.(`  ${f.rel} → OCR fallback returned no content — ${errDetail}`)
            appendNdjson(mdLog, {
              ts: isoNow(), status: "fail",
              source: f.rel, output: markitdownOutputRelPath(f.rel),
              engine: "tesseract", pages: "", duration_s: (Date.now() - startTime) / 1000,
              error: errDetail,
            })
            await emitDone(f.rel, "failed")
            continue
          }
        } else {
          fallbackEngine = "ppu-paddle-ocr"
          const result = await runOcrWorker([{ src: f.src, rel: f.rel, dest: f.dest }], {
            onLog,
            shouldAbort,
            signal: hooks?.signal,
            onChild: hooks?.onChild,
            detached: hooks?.ocrDetached ?? true,
          })
          ok = result.converted > 0 && convertedOutputExists(f.dest)
          if (ok) {
            converted++
            recoverable.push({ src: f.src, dest: f.dest })
            onLog?.(`  ${f.rel} → OCR fallback succeeded`)
          } else {
            failed++
            const errDetail = result.errors?.[0] ?? "OCR produced no convertible output"
            onLog?.(`  ${f.rel} → OCR fallback returned no content — ${errDetail}`)
            appendNdjson(mdLog, {
              ts: isoNow(), status: "fail",
              source: f.rel, output: markitdownOutputRelPath(f.rel),
              engine: "ppu-paddle-ocr", pages: "", duration_s: (Date.now() - startTime) / 1000,
              error: errDetail,
              mode: resolveOcrWorkerMode(),
            })
            await emitDone(f.rel, "failed")
            continue
          }
        }
      } catch (err) {
        if (isSpinosaCancellationError(err)) throw err
        if (err instanceof TesseractLowConfidenceError) {
          const binaryDest = path.join(path.dirname(f.dest), path.basename(f.src))
          try { rmSync(f.dest, { force: true }) } catch {}
          const copied = await safeCopyAsync(f.src, binaryDest)
          if (copied) {
            onLog?.(`  ${f.rel} → tesseract low confidence (avg ${err.avgConf.toFixed(1)}, low ${err.lowPct.toFixed(1)}%) — keeping original ${path.basename(binaryDest)}`)
            appendNdjson(mdLog, {
              ts: isoNow(), status: "skip",
              source: f.rel, output: path.basename(binaryDest),
              engine: "tesseract", pages: "", duration_s: (Date.now() - startTime) / 1000,
              error: `low confidence: ${err.message} — original kept`,
            })
            await emitDone(f.rel, "done")
            skipped++
            continue
          }
        }
        const errMsg = err instanceof Error ? err.message : String(err)
        failed++
        onLog?.(`  ${f.rel} → OCR fallback failed: ${errMsg}`)
        appendNdjson(mdLog, {
          ts: isoNow(), status: "fail",
          source: f.rel, output: markitdownOutputRelPath(f.rel),
          engine: fallbackEngine, pages: "", duration_s: (Date.now() - startTime) / 1000,
          error: errMsg,
          ...(fallbackEngine === "ppu-paddle-ocr" ? { mode: resolveOcrWorkerMode() } : {}),
        })
        await emitDone(f.rel, "failed")
        continue
      }
      appendNdjson(mdLog, {
        ts: isoNow(), status: "ok",
        source: f.rel, output: markitdownOutputRelPath(f.rel),
        engine: fallbackEngine, pages: "", duration_s: (Date.now() - startTime) / 1000,
        ...(fallbackEngine === "ppu-paddle-ocr" ? { mode: resolveOcrWorkerMode() } : {}),
      })
      await emitDone(f.rel)
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
  // Vision LLMs need network + API key and cannot be serialized to the NDJSON
  // child via a plain JSON payload (LanguageModel is not serializable). Run
  // vision phases in-process so the model can be created in the same process.
  const needsInProcess = (() => {
    if (!hooks?.ocrModelId) return false
    // Lazy sync check without async import — treat known vision ids as in-process.
    return hooks.ocrModelId.startsWith("openrouter/") || hooks.ocrModelId.includes(":free")
  })()
  if (hooks?.inProcess || needsInProcess || process.env.SPINOSA_IMPORT_IN_PROCESS === "1") {
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
    if (convertedOutputExists(f.dest)) { preSkipped.push(f) } else { toProcess.push(f) }
  }

  skipped += preSkipped.length
  const total = preSkipped.length + toProcess.length
  for (const [i, ps] of preSkipped.entries()) {
    throwIfSpinosaCancelled(shouldAbort)
    onLog?.(`  ${ps.rel} → already converted, skipped`)
    appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
      ts: isoNow(), status: "skip", source: ps.rel,
      output: ocrOutputRelPath(ps.rel),
      engine: tesseractAvailable() ? "tesseract" : "ppu-paddle-ocr", pages: "", duration_s: 0,
    })
    prog?.file("OCR", ++processed, total, ps.rel, "done")
  }

  // Primary path: tesseract for scanned PDFs (ita+eng+fra, 300dpi). PPU is fallback for one release.
  // Outcome-based: try MarkItDown first for PDFs that look like text (contain /Font), else tesseract.
  if (tesseractAvailable() && toProcess.length > 0) {
    const { ocrPdfViaTesseract } = await import("./tesseract-ocr")
    for (const file of toProcess) {
      throwIfSpinosaCancelled(shouldAbort)
      const start = Date.now()
      prog?.file("OCR", processed, total, file.rel, "processing")
      await yieldToEL()
      const ext = fileExt(file.src).toLowerCase()
      // Images should have been split to copyFiles; if any slip through, treat as copy-fail not OCR
      if (extInList(ext, IMAGE_EXTENSIONS)) {
        const err = "image files are copy-only (pending network OCR), not tesseract"
        failed++
        appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
          ts: isoNow(), status: "fail", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: "", duration_s: (Date.now() - start) / 1000, error: err,
        })
        onLog?.(`  ${file.rel} → ${err}`)
        prog?.file("OCR", ++processed, total, file.rel, "failed")
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
        continue
      }
      // Quick font marker check — avoids expensive MarkItDown on scanned/invalid PDFs without /Font
      let likelyTextPdf = false
      try {
        const head = readFileSync(file.src).subarray(0, 262144).toString("utf-8", 0, 262144)
        likelyTextPdf = head.includes("/Font") || head.includes("/CIDFont")
      } catch { likelyTextPdf = false }
      if (likelyTextPdf) {
        try {
          // Text-layer PDFs → try MarkItDown first (outcome-based isText detection, no pdf.js)
          const { MarkItDown } = await import("markitdown-ts")
          const { markitdownConvertFile } = await import("./markitdown-convert")
          const converter = new MarkItDown()
          const mdResult = await markitdownConvertFile(converter, file.src)
          throwIfSpinosaCancelled(shouldAbort)
          const mdText = mdResult?.markdown?.trim() ?? ""
          if (mdText) {
            mkdirSync(path.dirname(file.dest), { recursive: true })
            writeTextAtomicSafe(file.dest, mdText)
            injectColdFrontmatter(file.dest)
            converted++
            recoverable.push({ src: file.src, dest: file.dest })
            appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
              ts: isoNow(), status: "ok", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "markitdown", pages: "", duration_s: (Date.now() - start) / 1000,
            })
            onLog?.(`  ${file.rel} → text-layer PDF via MarkItDown (${mdText.length} chars)`)
            prog?.file("OCR", ++processed, total, file.rel, "done")
            continue
          }
        } catch (err) {
          if (isSpinosaCancellationError(err)) throw err
          // fall through to tesseract
        }
      }
      try {
        const result = await ocrPdfViaTesseract(file.src, file.dest, file.rel, { shouldAbort, onLog })
        throwIfSpinosaCancelled(shouldAbort)
        if (convertedOutputExists(file.dest)) {
          converted++
          recoverable.push({ src: file.src, dest: file.dest })
          appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
            ts: isoNow(), status: "ok", source: file.rel, output: ocrOutputRelPath(file.rel), engine: "tesseract", pages: String(result.pages), duration_s: (Date.now() - start) / 1000,
          })
          onLog?.(`  ${file.rel} → tesseract OCR succeeded (${result.pages} pages)`)
          prog?.file("OCR", ++processed, total, file.rel, "done")
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
      }
    }
    prog?.file("OCR", processed, total, "", "done")
    return { converted, skipped, failed, renamed: 0, recoverable }
  }

  if (toProcess.length > 0 && !ocrAvailable()) {
    const reason = ocrUnsupportedReason() ?? "OCR engine unavailable (tesseract missing and ppu-paddle-ocr not available)"
    onLog?.(`OCR unavailable: ${reason}`)
    for (const file of toProcess) {
      throwIfSpinosaCancelled(shouldAbort)
      failed++
      appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
        ts: isoNow(),
        status: "fail",
        source: file.rel,
        output: ocrOutputRelPath(file.rel),
        engine: "ppu-paddle-ocr",
        pages: "",
        duration_s: 0,
        error: reason,
      })
      onLog?.(`  ${file.rel} → OCR failed: ${reason}`)
      prog?.file("OCR", ++processed, total, file.rel, "failed")
      await yieldToEL()
    }
    return { converted, skipped, failed, renamed: 0, recoverable }
  }

  const { validateOcrImageInput } = await import("./ppu-ocr")
  for (let index = toProcess.length - 1; index >= 0; index--) {
    const file = toProcess[index]!
    const validationError = validateOcrImageInput(readFileSync(file.src), fileExt(file.src))
    if (!validationError) continue
    toProcess.splice(index, 1)
    failed++
    processed++
    onLog?.(`PPU PaddleOCR failed: ${file.rel} — invalid OCR image input: ${validationError}`)
    appendNdjson(path.join(logsDir, "ocr-processed.ndjson"), {
      ts: isoNow(),
      status: "fail",
      source: file.rel,
      output: ocrOutputRelPath(file.rel),
      engine: "ppu-paddle-ocr",
      pages: "",
      duration_s: 0,
      error: `invalid OCR image input: ${validationError}`,
    })
    prog?.file("OCR", processed, total, file.rel, "failed")
  }
  if (toProcess.length > 0) {
    const ocrLog = path.join(logsDir, "ocr-processed.ndjson")
    const mode = resolveOcrWorkerMode()
    onLog?.(`PPU PaddleOCR: Processing ${toProcess.length} files (child worker, model loaded once per worker)`)
    spinosaLogInfo("ocr", `processing ${toProcess.length} file(s) mode=${mode}`)

    // One child loads the model once and walks the remaining queue. If the native
    // stack segfaults, collect that file's failure and respawn for the rest.
    let remaining: ClassifiedEntry[] = [...toProcess]
    // Per-batch rel -> entry index: onFile/onFileStart messages arrive for every
    // file and a linear scan over the whole queue would make large imports O(n²).
    const batchByRel = new Map(remaining.map((f) => [f.rel, f] as const))
    while (remaining.length > 0) {
      throwIfSpinosaCancelled(shouldAbort)
      const batch = remaining as PpuOcrFile[]
      const batchStart = Date.now()
      const finished = new Map<string, { ok: boolean; error?: string; duration_s: number }>()
      let crashedRel: string | undefined
      const inBatch = (rel: string) => batchByRel.get(rel)

      const result = await runOcrWorker(batch, {
        onLog,
        shouldAbort,
        signal: hooks?.signal,
        onChild: hooks?.onChild,
        onFileStart: (relPath) => {
          // Live label for TUI ProgressEmitter (numerator stays at files completed).
          prog?.file("OCR", processed, total, relPath, "processing")
        },
        onPageProgress: (_current, _totalFiles, relPath, page) => {
          // Label-only: omit status so late page ticks cannot revert done → processing.
          prog?.file("OCR", processed, total, page ? `${relPath} (${page})` : relPath)
        },
        onProgress: (_current, _totalFiles, relPath) => {
          // Worker "progress" is label-only: never add worker current onto processed
          // (onFile already advanced the numerator and emitted done/failed).
          prog?.file("OCR", processed, total, relPath)
        },
        onFile: (fr) => {
          const entry = batchByRel.get(fr.rel)
          const ok = fr.ok && !!entry && convertedOutputExists(entry.dest)
          const error = !ok
            ? (fr.error
              ?? (fr.ok
                ? "OCR claimed success but output is missing or is a binary masquerading as markdown"
                : "OCR produced no convertible output"))
            : undefined
          finished.set(fr.rel, {
            ok,
            error,
            duration_s: (Date.now() - batchStart) / 1000,
          })
          if (ok && entry) {
            converted++
            recoverable.push({ src: entry.src, dest: entry.dest })
          } else {
            failed++
            spinosaLogWarn("ocr", `${fr.rel}: ${error}`)
            onLog?.(`  ${fr.rel} → OCR failed: ${error}`)
          }
          appendNdjson(ocrLog, {
            ts: isoNow(),
            status: ok ? "ok" : "fail",
            source: fr.rel,
            output: ocrOutputRelPath(fr.rel),
            engine: "ppu-paddle-ocr",
            pages: "",
            duration_s: (Date.now() - batchStart) / 1000,
            ...(error ? { error } : {}),
            mode,
          })
          prog?.file("OCR", ++processed, total, fr.rel, ok ? "done" : "failed")
        },
      })

      crashedRel = result.crashedRel
      if (result.crashed && crashedRel && !finished.has(crashedRel)) {
        const error = result.errors?.[0] ?? `OCR worker crashed while processing ${crashedRel}`
        finished.set(crashedRel, { ok: false, error, duration_s: (Date.now() - batchStart) / 1000 })
        failed++
        spinosaLogWarn("ocr", `${crashedRel}: ${error}`)
        onLog?.(`  ${crashedRel} → OCR failed: ${error}`)
        appendNdjson(ocrLog, {
          ts: isoNow(),
          status: "fail",
          source: crashedRel,
          output: ocrOutputRelPath(crashedRel),
          engine: "ppu-paddle-ocr",
          pages: "",
          duration_s: (Date.now() - batchStart) / 1000,
          error,
          mode,
          crashed: true,
        })
        prog?.file("OCR", ++processed, total, crashedRel, "error")
      } else if (result.crashed && !crashedRel && remaining.length > 0 && finished.size === 0) {
        // Worker died before any file-start (e.g. model init segfault).
        const head = remaining[0]!
        const error = result.errors?.[0] ?? "OCR worker crashed before processing any file"
        finished.set(head.rel, { ok: false, error, duration_s: (Date.now() - batchStart) / 1000 })
        failed++
        spinosaLogWarn("ocr", `${head.rel}: ${error}`)
        onLog?.(`  ${head.rel} → OCR failed: ${error}`)
        appendNdjson(ocrLog, {
          ts: isoNow(),
          status: "fail",
          source: head.rel,
          output: ocrOutputRelPath(head.rel),
          engine: "ppu-paddle-ocr",
          pages: "",
          duration_s: (Date.now() - batchStart) / 1000,
          error,
          mode,
          crashed: true,
        })
        prog?.file("OCR", ++processed, total, head.rel, "error")
      }

      // Advance past finished (+ crashed) files; respawn for the rest (new model load).
      remaining = remaining.filter((f) => !finished.has(f.rel))
      if (!result.crashed) {
        // Clean completion: anything not reported is a protocol gap — mark failed once.
        for (const f of remaining) {
          const error = "OCR worker finished without reporting this file"
          failed++
          appendNdjson(ocrLog, {
            ts: isoNow(),
            status: "fail",
            source: f.rel,
            output: ocrOutputRelPath(f.rel),
            engine: "ppu-paddle-ocr",
            pages: "",
            duration_s: (Date.now() - batchStart) / 1000,
            error,
            mode,
          })
          prog?.file("OCR", ++processed, total, f.rel, "failed")
        }
        remaining = []
      } else if (remaining.length > 0) {
        onLog?.(`PPU PaddleOCR: worker crashed — continuing with ${remaining.length} remaining file(s) in a new child`)
        spinosaLogWarn("ocr", `respawning worker for ${remaining.length} remaining file(s)`)
      }
    }
    prog?.file("OCR", processed, total, "", "done")
  }

  return { converted, skipped, failed, renamed: 0, recoverable }
}

function workerScriptPath(): string {
  return fileURLToPath(new URL("ppu-ocr-worker.ts", import.meta.url))
}

export type OcrWorkerMode = "binary-cli" | "bun-script"

/**
 * OCR always runs in a child process:
 * - product binary → `spinosa internal ocr-worker <json>` (isolates native segfaults)
 * - source/dev → `bun run ppu-ocr-worker.ts <json>`
 * Never spawn `argv0 run /$bunfs/...` (that re-enters the kernel CLI).
 */
export function resolveOcrWorkerMode(workerScript = workerScriptPath()): OcrWorkerMode {
  if (isCompiledBinaryDistribution()) return "binary-cli"
  if (workerScript.includes("$bunfs")) return "binary-cli"
  const exe = path.basename(process.argv0 || process.execPath || "")
  if (exe === "spinosa" || exe.startsWith("spinosa-")) return "binary-cli"
  return "bun-script"
}

/** @deprecated Use resolveOcrWorkerMode — OCR is never in-process by design. */
export function shouldRunOcrInProcess(workerScript = workerScriptPath()): boolean {
  void workerScript
  return false
}

function bunExecutableForWorker(): string {
  const exec = process.execPath || ""
  if (/(^|\/)bun(\.exe)?$/i.test(exec)) return exec
  return "bun"
}

function productBinaryExecutable(): string {
  return process.execPath || process.argv0 || "spinosa"
}

export type OcrWorkerRunResult = PpuOcrBatchResult & {
  mode: OcrWorkerMode
  /** Files that received a terminal `file` event from the worker. */
  finishedRels: string[]
  /** File that had started but not finished when the worker died (segfault / kill). */
  crashedRel?: string
  crashed?: boolean
}

/** Parse one NDJSON worker line into callbacks. Returns in-flight rel when type is file-start. */
export function consumeOcrWorkerNdjsonLine(
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
): void {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const msg = JSON.parse(trimmed) as Record<string, unknown>
    switch (msg.type) {
      case "progress":
        options?.onProgress?.(Number(msg.current), Number(msg.total), String(msg.relPath ?? ""))
        break
      case "pageProgress":
        options?.onPageProgress?.(
          Number(msg.current),
          Number(msg.total),
          String(msg.relPath ?? ""),
          String(msg.page ?? ""),
        )
        break
      case "log":
        options?.onLog?.(String(msg.message ?? ""))
        break
      case "file-start": {
        const rel = String(msg.relPath ?? "")
        state.inFlightRel = rel
        options?.onFileStart?.(rel)
        break
      }
      case "file": {
        const rel = String(msg.relPath ?? "")
        const ok = Boolean(msg.ok)
        const error = typeof msg.error === "string" ? msg.error : undefined
        const fr = { rel, ok, ...(error ? { error } : {}) }
        state.fileResults.push(fr)
        state.finishedRels.push(rel)
        if (state.inFlightRel === rel) state.inFlightRel = undefined
        options?.onFile?.(fr)
        break
      }
      case "done":
        state.workerConverted = Number(msg.converted ?? 0)
        state.workerSkipped = Number(msg.skipped ?? 0)
        if (Array.isArray(msg.errors)) {
          for (const e of msg.errors) state.errors.push(String(e))
        }
        break
      case "error":
        state.errors.push(String(msg.message ?? "worker error"))
        options?.onLog?.(`PPU PaddleOCR worker: ${msg.message}`)
        break
    }
  } catch {
    options?.onLog?.(`PPU PaddleOCR worker: ${trimmed}`)
  }
}

async function runOcrWorker(
  files: PpuOcrFile[],
  options?: {
    onLog?: (msg: string) => void
    onProgress?: (current: number, total: number, relPath: string) => void
    onPageProgress?: (current: number, total: number, relPath: string, page: string) => void
    onFileStart?: (relPath: string) => void
    onFile?: (result: { rel: string; ok: boolean; error?: string }) => void
    shouldAbort?: () => boolean
    signal?: AbortSignal
    onChild?: (child: ChildProcess) => void
    /** Default true — isolate segfaults. Nested MD→OCR uses false so cancel kills the group. */
    detached?: boolean
  },
): Promise<OcrWorkerRunResult> {
  throwIfSpinosaCancelled(options?.shouldAbort)
  const mode = resolveOcrWorkerMode()
  const workerPayload = encodeWorkerPayload({ files })
  const detached = options?.detached ?? true
  // Detached so a native segfault/kill does not take down the TUI parent.
  // Parent still tracks the PID and terminates the process group on cancel.
  const child =
    mode === "binary-cli"
      ? spawn(productBinaryExecutable(), ["internal", "ocr-worker", workerPayload.arg], {
          stdio: ["ignore", "pipe", "pipe"],
          detached,
          env: process.env,
        })
      : spawn(bunExecutableForWorker(), ["run", workerScriptPath(), workerPayload.arg], {
          stdio: ["ignore", "pipe", "pipe"],
          detached,
        })

  options?.onChild?.(child)

  const state = {
    workerConverted: 0,
    workerSkipped: 0,
    errors: [] as string[],
    fileResults: [] as Array<{ rel: string; ok: boolean; error?: string }>,
    finishedRels: [] as string[],
    inFlightRel: undefined as string | undefined,
  }

  // Stream NDJSON as it arrives so TUI ProgressEmitter updates live (not only after exit).
  let stdoutCarry = ""
  let stderrBuf = ""
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutCarry += chunk.toString()
    let nl: number
    while ((nl = stdoutCarry.indexOf("\n")) >= 0) {
      const line = stdoutCarry.slice(0, nl)
      stdoutCarry = stdoutCarry.slice(nl + 1)
      consumeOcrWorkerNdjsonLine(line, state, options)
    }
  })
  child.stderr?.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString() })

  const { code, signal, aborted } = await waitForOcrChild(child, options?.shouldAbort, options?.signal).finally(() =>
    disposeWorkerPayload(workerPayload.tempPath),
  )
  if (stdoutCarry.trim()) consumeOcrWorkerNdjsonLine(stdoutCarry, state, options)

  // Only unref after we are done waiting so cancel keeps a live handle.
  try {
    child.unref()
  } catch {
    // ignore
  }

  if (aborted) {
    throw new SpinosaCancellationError("OCR worker cancelled")
  }

  if (stderrBuf.trim()) {
    const errLine = stderrBuf.trim().split("\n").slice(-3).join(" | ")
    state.errors.push(errLine)
    options?.onLog?.(`PPU PaddleOCR worker stderr: ${errLine}`)
  }

  const crashed = Boolean(signal) || (code !== 0 && code !== null)
  if (signal) {
    const msg = `PPU PaddleOCR worker terminated by signal ${signal} — worker crash`
    state.errors.push(msg)
    options?.onLog?.(msg)
  } else if (code !== 0 && code !== null) {
    const msg = `PPU PaddleOCR worker exited with code ${code}`
    state.errors.push(msg)
    options?.onLog?.(msg)
  }

  // Prefer per-file events for accurate converted/skipped when the worker crashed mid-batch.
  let workerConverted = state.workerConverted
  let workerSkipped = state.workerSkipped
  if (state.fileResults.length > 0) {
    workerConverted = state.fileResults.filter((f) => f.ok).length
    workerSkipped = state.fileResults.filter((f) => !f.ok).length
  }

  return {
    converted: workerConverted,
    skipped: workerSkipped,
    errors: state.errors.length > 0 ? state.errors : undefined,
    files: state.fileResults.length > 0 ? state.fileResults : undefined,
    mode,
    finishedRels: state.finishedRels,
    crashedRel: crashed ? state.inFlightRel : undefined,
    crashed,
  }
}

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
  const workerPayload = encodeWorkerPayload({ files, logsDir })
  const child =
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

  const { code, signal, aborted } = await waitForOcrChild(child, shouldAbort, hooks?.signal).finally(() =>
    disposeWorkerPayload(workerPayload.tempPath),
  )
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
): Promise<{ code: number | null; signal: string | null; aborted: boolean }> {
  return new Promise((resolve) => {
    let settled = false
    let terminating = false
    const abortRequested = () => Boolean(shouldAbort?.() || signal?.aborted)

    const finish = (result: { code: number | null; signal: string | null; aborted: boolean }) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      if (signal) {
        try {
          signal.removeEventListener("abort", onAbortEvent)
        } catch {
          // ignore
        }
      }
      resolve(result)
    }

    const requestTerminate = () => {
      if (settled || terminating) return
      terminating = true
      clearInterval(poll)
      void terminateChild(child).then(() => {
        finish({ code: null, signal: "SIGTERM", aborted: true })
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

async function convertTextPdf(srcFile: string, destFile: string, relPath: string, shouldAbort?: () => boolean): Promise<void> {
  const title = path.basename(relPath, path.extname(relPath))
  const { pdfExtractPageTexts } = await import("../extension/pdf-js")
  const pageTexts = await pdfExtractPageTexts(srcFile)
  throwIfSpinosaCancelled(shouldAbort)
  const pages = pageTexts.length

  if (pages === 1) {
    mkdirSync(path.dirname(destFile), { recursive: true })
    writeTextAtomicSafe(destFile, `# ${title}\n\n${pageTexts[0]!.text.trim() || "[No text extracted]"}\n`)
    injectColdFrontmatter(destFile)
    return
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
  }
  mkdirSync(path.dirname(destFile), { recursive: true })
  writeTextAtomicSafe(
    destFile,
    `# ${title}\n\n${pageTexts.map(({ page }) => `- [Page ${page}](${path.basename(pageDir)}/page-${String(page).padStart(3, "0")}.md)`).join("\n")}\n`,
  )
  injectColdFrontmatter(destFile)
}

type CopyDirectResult = "copied" | "skipped" | "failed"

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

  if (await safeCopyAsync(srcFile, destFile, {
    onRetry: (attempt, reason) => {
      onLog?.(`  ${relPath} → retry ${attempt} (${reason})`)
      onRetry?.(attempt, reason)
    },
    onRename: (original, renamed) => {
      onLog?.(`  ${relPath} → renamed (name too long)`)
      onRename?.(original, renamed)
    },
  })) {
    onLog?.(`  ${relPath} → copied`)
    return "copied"
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
    })
    throwIfSpinosaCancelled(shouldAbort)
    if (!route) continue

    const routePhase = route === "markitdown" ? "markitdown" : route === "ocr" ? "ocr" : "direct"
    // "copy" (image_pending) shares direct phase for verify filtering
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
        try {
          mkdirSync(path.dirname(destFile), { recursive: true })
          const converter = new MarkItDown()
          const result = await markitdownConvertFile(converter, srcFile)
          throwIfSpinosaCancelled(shouldAbort)
        const text = stripAnsi(result?.markdown ?? "")
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
      case "ocr": {
        let ocrConverted = 0
        let ocrError: string | undefined
        if (tesseractAvailable()) {
          try {
            const { ocrPdfViaTesseract } = await import("./tesseract-ocr")
            // Outcome-based: try MarkItDown first, success → text PDF
            let markitdownText = ""
            let markitdownOk = false
            try {
              const { MarkItDown } = await import("markitdown-ts")
              const { markitdownConvertFile } = await import("./markitdown-convert")
              const converter = new MarkItDown()
              const mdRes = await markitdownConvertFile(converter, srcFile)
              throwIfSpinosaCancelled(shouldAbort)
              markitdownText = mdRes?.markdown?.trim() ?? ""
              markitdownOk = markitdownText.length > 0
            } catch { markitdownOk = false }
            if (markitdownOk) {
              mkdirSync(path.dirname(destFile), { recursive: true })
              writeTextAtomicSafe(destFile, markitdownText)
              injectColdFrontmatter(destFile)
              ocrConverted = 1
            } else {
              await ocrPdfViaTesseract(srcFile, destFile, relPath, { shouldAbort, onLog })
              if (convertedOutputExists(destFile)) ocrConverted = 1
              else ocrError = "tesseract produced no convertible markdown"
            }
          } catch (err) {
            if (isSpinosaCancellationError(err)) throw err
            ocrError = err instanceof Error ? err.message : String(err)
            onLog?.(`    tesseract failed: ${ocrError}`)
          }
        } else if (ocrAvailable()) {
          try {
            const ppuResult = await runOcrWorker([{ src: srcFile, rel: relPath, dest: destFile }], { onLog, shouldAbort })
            ocrConverted = ppuResult.converted
            if (ocrConverted <= 0 || !convertedOutputExists(destFile)) {
              ocrError = ppuResult.errors?.[0] ?? "OCR produced no convertible markdown"
              ocrConverted = 0
            }
          } catch (err) {
            if (isSpinosaCancellationError(err)) throw err
            ocrError = err instanceof Error ? err.message : String(err)
            onLog?.(`    PPU OCR engine failed: ${ocrError} — leaving file missing (no binary-as-md fallback)`)
          }
        } else {
          ocrError = ocrUnsupportedReason() ?? "OCR engine unavailable"
        }
        if (ocrConverted > 0 && convertedOutputExists(destFile)) {
          injectColdFrontmatter(destFile)
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

  options?.onClassified?.({
    directFiles: classified.directFiles,
    markitdownFiles: classified.markitdownFiles,
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
    const dr = await processDirectCopy(classified.directFiles, prog, options?.onLog, options?.overwrite, options?.shouldAbort)
    res.copied += dr.converted; res.skipped += dr.skipped; res.failed += dr.failed
  }

  if (copyFiles.length > 0) {
    // Images: copy-only, pending network OCR
    if (runPhase("direct")) {
      options?.onPhaseChange?.("direct", `Copying ${copyFiles.length} images (pending network OCR)...`)
    }
    const cr = await processImageCopy(copyFiles, prog, options?.onLog, options?.overwrite, options?.shouldAbort)
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
