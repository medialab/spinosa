import { mkdirSync, readFileSync, appendFileSync, readdirSync, rmSync, mkdtempSync } from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { fileExt, IMAGE_EXTENSIONS, extInList } from "../constants"
import { safeCopyAsync, writeTextAtomicSafe } from "../utils/fs"
import { injectColdFrontmatter, convertedOutputExists } from "./frontmatter"
import { isSpinosaCancellationError, SpinosaCancellationError, throwIfSpinosaCancelled } from "./cancellation"
import { ProgressEmitter } from "../progress/progress"
import { markitdownOutputRelPath } from "../extension/classifier"
import { VISION_TRANSCRIBE_PROMPT, mimeForImageExt, isVisionModelId } from "./vision-helpers"
import { waitAbortableChild } from "./tesseract-ocr"
import { recordResult, manifestDest, type ManifestStatus } from "./manifest"
import { optimizeVisionImage } from "./vision-image"
import type { ClassifiedEntry, PhaseResult } from "./pipeline"

export type VisionTranscribeRequest = {
  providerID: string
  modelID: string
  prompt: string
  image: { mime: string; data: string }
}

export type VisionTranscribe = (request: VisionTranscribeRequest) => Promise<string>

/** Maximum time to wait for one provider transcription attempt. */
export const VISION_ATTEMPT_TIMEOUT_MS = 120_000

export type VisionHooks = {
  /** Selected vision model id (e.g. openai/gpt-4o-mini, openrouter/qwen2.5-vl:free). Can be getter for live-switch. */
  visionModelId?: string | (() => string)
  /** Server-side transcribe callback using kernel Provider/auth pool. */
  transcribeVision?: VisionTranscribe
  signal?: AbortSignal
  onVisionFailure?: (rel: string, modelId: string, error: string) => Promise<"retry" | "skip" | "abort">
  onChild?: (child: import("node:child_process").ChildProcess) => void
}

function resolveVisionModelId(raw: VisionHooks["visionModelId"]): string | undefined {
  if (!raw) return undefined
  return typeof raw === "function" ? raw() : raw
}

function parseVisionModelId(id: string): { providerID: string; modelID: string } | undefined {
  const slash = id.indexOf("/")
  if (slash <= 0) return undefined
  const providerID = id.slice(0, slash)
  const modelID = id.slice(slash + 1)
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

function isoNow(): string {
  return new Date().toISOString()
}
function appendNdjson(p: string, obj: Record<string, unknown>): void {
  appendFileSync(p, JSON.stringify(obj) + "\n", "utf-8")
}
function yieldToEL(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  return promise
}

function formatImageBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Terminal file states land in the import manifest so resume runs skip done files. */
function recordVisionResult(
  logsDir: string,
  f: ClassifiedEntry,
  status: ManifestStatus,
  engine: string,
  model?: string,
): void {
  recordResult({
    logsDir, rel: f.rel, ext: fileExt(f.src), route: "vision", status,
    srcFile: f.src, dest: manifestDest(logsDir, f.dest), engine, model,
  })
}

function titleFromRel(rel: string): string {
  const stem = path.basename(rel, path.extname(rel))
  return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || stem
}

function pdftoppmPresent(): boolean {
  try {
    return typeof Bun !== "undefined" && !!(Bun as unknown as { which?: (cmd: string) => string | null }).which?.("pdftoppm")
  } catch {
    return false
  }
}

type PagePayload = { mime: string; data: string; label: string }

/** Optimize one image buffer into a model-ready payload (optimize, else original). */
async function prepareImagePayload(
  buf: Buffer,
  srcLabel: string,
  onLog?: (msg: string) => void,
): Promise<PagePayload> {
  const extForMime = fileExt(srcLabel).toLowerCase()
  const originalMime = mimeForImageExt(extForMime)
  try {
    const image = await optimizeVisionImage(buf, originalMime)
    const mime = image.mime
    const b64 = image.data.toString("base64")
    if (image.optimized) {
      onLog?.(
        `  ${srcLabel} → image optimized ${image.originalWidth}×${image.originalHeight} → ${image.width}×${image.height} · ${formatImageBytes(image.originalBytes)} → ${formatImageBytes(image.data.byteLength)}`,
      )
    } else {
      const dimensions = image.width && image.height ? ` ${image.width}×${image.height}` : ""
      onLog?.(`  ${srcLabel} → image already efficient${dimensions} · ${formatImageBytes(image.data.byteLength)}`)
    }
    return { mime, data: b64, label: srcLabel }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onLog?.(`  ${srcLabel} → image optimization unavailable (${message.slice(0, 120)}); sending original`)
    return { mime: originalMime, data: buf.toString("base64"), label: srcLabel }
  }
}

/**
 * Render every PDF page to PNG (pdftoppm, 300dpi) and prepare payloads.
 * Mirrors the tesseract phase renderer so vision sees the same pages.
 */
async function renderPdfPagesToPayloads(
  srcPath: string,
  rel: string,
  shouldAbort: (() => boolean) | undefined,
  onLog?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<PagePayload[]> {
  if (!pdftoppmPresent()) {
    throw new Error(
      "PDF page rendering needs pdftoppm (poppler-utils), which is not installed — install it or pick Tesseract for scanned PDFs",
    )
  }
  const tmpDir = mkdtempSync(path.join(tmpdir(), "spinosa-vision-pdf-"))
  try {
    throwIfSpinosaCancelled(shouldAbort)
    if (signal?.aborted) throw new SpinosaCancellationError("Vision cancelled")
    const prefix = path.join(tmpDir, "page")
    const proc = Bun.spawn(["pdftoppm", "-png", "-r", "300", srcPath, prefix], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exit = await waitAbortableChild(proc, {
      shouldAbort,
      signal,
      label: `pdftoppm ${rel}`,
    })
    if (exit !== 0) {
      const errText = await new Response(proc.stderr as unknown as ReadableStream).text().catch(() => "")
      throw new Error(`pdftoppm failed (exit ${exit}): ${errText.slice(0, 400)}`)
    }
    throwIfSpinosaCancelled(shouldAbort)
    const pngs = readdirSync(tmpDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
    if (pngs.length === 0) throw new Error("pdftoppm produced no pages")
    onLog?.(`  ${rel} → rendered ${pngs.length} page${pngs.length === 1 ? "" : "s"} for vision`)
    const payloads: PagePayload[] = []
    for (const [i, png] of pngs.entries()) {
      throwIfSpinosaCancelled(shouldAbort)
      const buf = readFileSync(path.join(tmpDir, png!))
      // Label keeps the .png suffix so MIME detection sees the real format.
      const payload = await prepareImagePayload(buf, `${rel}#page${i + 1}.png`, onLog)
      payloads.push(payload)
    }
    return payloads
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

const isRetryableVisionError = (msg: string) => /429|rate.?limit|timeout|timed out|503|502|500|ECONNRESET|ETIMEDOUT/i.test(msg)
const isAuthError = (msg: string) => /401|403|Incorrect API key|invalid_api_key|authentication|unauthorized/i.test(msg)

/** One image → one transcription, with retry/backoff. Throws the last error. */
async function transcribeImagePayload(
  transcribeVision: VisionTranscribe,
  providerID: string,
  modelID: string,
  currentId: string,
  payload: PagePayload,
  rel: string,
  pageLabel: string,
  signal: AbortSignal | undefined,
  shouldAbort: (() => boolean) | undefined,
  onLog?: (msg: string) => void,
): Promise<string> {
  const request: VisionTranscribeRequest = {
    providerID,
    modelID,
    prompt: VISION_TRANSCRIBE_PROMPT,
    image: { mime: payload.mime, data: payload.data },
  }
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    throwIfSpinosaCancelled(shouldAbort)
    if (shouldAbort?.()) throw new SpinosaCancellationError("Vision cancelled")
    if (signal?.aborted) throw new SpinosaCancellationError("Vision cancelled")
    const attemptNumber = attempt + 1
    onLog?.(`  ${rel} → sending ${pageLabel} to ${currentId} (attempt ${attemptNumber}/3)…`)
    await yieldToEL()
    try {
      const text = await transcribeWithTimeout(transcribeVision, request, signal, shouldAbort, () => {
        onLog?.(`  ${rel} → waiting for model response (up to ${VISION_ATTEMPT_TIMEOUT_MS / 1000}s)…`)
      })
      if (!text || !text.trim()) throw new Error("Vision model returned no text")
      return text.trim()
    } catch (e) {
      if (isSpinosaCancellationError(e)) throw e
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (isAuthError(msg)) break
      if (!isRetryableVisionError(msg) || attempt === 2) break
      const backoff = 1000 * Math.pow(2, attempt) + Math.random() * 500
      onLog?.(`  ${rel} → retry delay before attempt ${attempt + 2}/3 (${Math.round(backoff)}ms after ${msg.slice(0, 120)})`)
      await new Promise((r) => setTimeout(r, backoff))
      throwIfSpinosaCancelled(shouldAbort)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function transcribeWithTimeout(
  transcribeVision: VisionTranscribe,
  request: VisionTranscribeRequest,
  signal: AbortSignal | undefined,
  shouldAbort: (() => boolean) | undefined,
  onRequestStarted?: () => void,
): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(new SpinosaCancellationError("Vision cancelled"))
    if (shouldAbort?.() || signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`vision timeout after ${VISION_ATTEMPT_TIMEOUT_MS / 1000}s`)), VISION_ATTEMPT_TIMEOUT_MS)
  })

  try {
    const transcription = transcribeVision(request)
    onRequestStarted?.()
    return await Promise.race([transcription, timeoutPromise, abortPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
  }
}

/**
 * Dedicated vision transcription phase — images → Markdown via injected kernel callback.
 * Core reads image bytes, creates MIME/base64 payload, calls callback, preserves timeout,
 * cancellation, retry, auth-failure pause, and image-copy fallback. No auth reads here.
 */
export async function processVisionInProcess(
  files: ClassifiedEntry[],
  logsDir: string,
  prog?: ProgressEmitter,
  onLog?: (msg: string) => void,
  shouldAbort?: () => boolean,
  hooks?: VisionHooks,
): Promise<PhaseResult> {
  let converted = 0
  let skipped = 0
  let failed = 0
  const recoverable: { src: string; dest: string }[] = []
  let processed = 0
  // Manual per-file retries (user pressed retry) are bounded: without a cap,
  // always-retry loops forever; page payloads are cached so retries skip
  // the expensive pdftoppm re-render.
  const MAX_MANUAL_RETRIES = 3
  const manualRetries = new Map<string, number>()
  const pageCache = new Map<string, PagePayload[]>()
  const noteManualRetry = (rel: string): boolean => {
    const n = (manualRetries.get(rel) ?? 0) + 1
    manualRetries.set(rel, n)
    return n <= MAX_MANUAL_RETRIES
  }

  const preSkipped: ClassifiedEntry[] = []
  const toProcess: ClassifiedEntry[] = []
  for (const f of files) {
    if (convertedOutputExists(f.dest) && !f.force) preSkipped.push(f)
    else toProcess.push(f)
  }
  skipped += preSkipped.length
  const total = preSkipped.length + toProcess.length

  const emitStart = async (relPath: string) => {
    prog?.file("Vision", processed, total, relPath, "processing")
    await yieldToEL()
  }
  const emitDone = async (relPath: string, status: "done" | "failed" = "done") => {
    prog?.file("Vision", ++processed, total, relPath, status)
    await yieldToEL()
  }

  const visionLog = path.join(logsDir, "vision-processed.ndjson")

  const resolveVisionModelIdMemo = () => resolveVisionModelId(hooks?.visionModelId)

  for (const ps of preSkipped) {
    throwIfSpinosaCancelled(shouldAbort)
    await emitStart(ps.rel)
    onLog?.(`  ${ps.rel} → already transcribed, skipped`)
    appendNdjson(visionLog, {
      ts: isoNow(),
      status: "skip",
      source: ps.rel,
      output: markitdownOutputRelPath(ps.rel),
      engine: "vision",
      pages: "",
      duration_s: 0,
    })
    recordVisionResult(logsDir, ps, "done", "vision", resolveVisionModelIdMemo())
    await emitDone(ps.rel)
  }

  for (let _idx = 0; _idx < toProcess.length; _idx++) {
    const f = toProcess[_idx]!
    throwIfSpinosaCancelled(shouldAbort)
    const ext = fileExt(f.src).toLowerCase()
    const isPdfFile = ext === "pdf"
    if (!extInList(ext, IMAGE_EXTENSIONS) && !isPdfFile) {
      onLog?.(`  ${f.rel} → not an image or PDF, skipping vision`)
      failed++
      await emitDone(f.rel, "failed")
      recordVisionResult(logsDir, f, "failed", "vision")
      appendNdjson(visionLog, {
        ts: isoNow(),
        status: "fail",
        source: f.rel,
        output: markitdownOutputRelPath(f.rel),
        engine: "vision",
        pages: "",
        duration_s: 0,
        error: `not an image or PDF: ${ext}`,
      })
      continue
    }

    await emitStart(f.rel)
    const currentId = resolveVisionModelIdMemo()
    const isVision = currentId ? isVisionModelId(currentId) : false

    // If not a vision model or no callback, fallback to image copy
    if (!isVision || !currentId || !hooks?.transcribeVision) {
      const reason = !isVision ? `not a vision model: ${currentId ?? "none"}` : !hooks?.transcribeVision ? "vision transcribe callback not provided" : "unknown"
      const fallbackDest = path.join(path.dirname(f.dest), path.basename(f.src))
      try {
        mkdirSync(path.dirname(fallbackDest), { recursive: true })
      } catch {}
      const ok = await safeCopyAsync(f.src, fallbackDest)
      if (ok) {
        converted++
        recoverable.push({ src: f.src, dest: fallbackDest })
        appendNdjson(visionLog, {
          ts: isoNow(),
          status: "ok",
          source: f.rel,
          output: path.basename(fallbackDest),
          engine: "image-copy-fallback",
          pages: "",
          duration_s: 0,
          error: reason,
        })
        onLog?.(`  ${f.rel} → image copy fallback (${reason})`)
        recordVisionResult(logsDir, f, "done", "image-copy-fallback", currentId)
        await emitDone(f.rel)
      } else {
        failed++
        recordVisionResult(logsDir, f, "failed", "image-copy-fallback", currentId)
        appendNdjson(visionLog, {
          ts: isoNow(),
          status: "fail",
          source: f.rel,
          output: markitdownOutputRelPath(f.rel),
          engine: "image-copy-fallback",
          pages: "",
          duration_s: 0,
          error: `copy fallback failed (${reason})`,
        })
        onLog?.(`  ${f.rel} → image copy fallback failed (${reason})`)
        await emitDone(f.rel, "failed")
      }
      continue
    }

    const parsed = parseVisionModelId(currentId)
    if (!parsed) {
      // Invalid model id format -> fallback
      const fallbackDest = path.join(path.dirname(f.dest), path.basename(f.src))
      try {
        mkdirSync(path.dirname(fallbackDest), { recursive: true })
      } catch {}
      const ok = await safeCopyAsync(f.src, fallbackDest)
      if (ok) {
        converted++
        recoverable.push({ src: f.src, dest: fallbackDest })
        appendNdjson(visionLog, {
          ts: isoNow(),
          status: "ok",
          source: f.rel,
          output: path.basename(fallbackDest),
          engine: "image-copy-fallback",
          pages: "",
          duration_s: 0,
          error: `invalid vision model id: ${currentId}`,
        })
        onLog?.(`  ${f.rel} → image copy fallback (invalid vision model id)`)
        recordVisionResult(logsDir, f, "done", "image-copy-fallback", currentId)
        await emitDone(f.rel)
      } else {
        failed++
        recordVisionResult(logsDir, f, "failed", "image-copy-fallback", currentId)
        await emitDone(f.rel, "failed")
      }
      continue
    }

    const startTime = Date.now()

    // Build per-page payloads: a single image is one page; a scanned PDF is
    // rendered page-by-page (same 300dpi pdftoppm renderer as tesseract).
    let pages: PagePayload[] | undefined
    let readErr: unknown
    const cached = pageCache.get(f.rel)
    if (cached) {
      pages = cached
      onLog?.(`  ${f.rel} → reusing prepared pages (retry, no re-render)`)
    } else {
      try {
        if (isPdfFile) {
          onLog?.(`  ${f.rel} → rendering PDF pages…`)
          await yieldToEL()
          pages = await renderPdfPagesToPayloads(f.src, f.rel, shouldAbort, onLog, hooks.signal)
        } else {
          onLog?.(`  ${f.rel} → preparing image…`)
          await yieldToEL()
          const buf = readFileSync(f.src)
          onLog?.(`  ${f.rel} → optimizing image…`)
          await yieldToEL()
          pages = [await prepareImagePayload(buf, f.rel, onLog)]
        }
        await yieldToEL()
        throwIfSpinosaCancelled(shouldAbort)
        if (pages) pageCache.set(f.rel, pages)
      } catch (e) {
        readErr = e
      }
    }
    if (readErr !== undefined || !pages || pages.length === 0) {
      if (readErr && isSpinosaCancellationError(readErr)) throw readErr
      const errMsg = readErr instanceof Error ? readErr.message : String(readErr)
      onLog?.(`Vision failed: ${f.rel} — failed to read ${isPdfFile ? "PDF" : "image"}: ${errMsg}`)
      failed++
      await emitDone(f.rel, "failed")
      recordVisionResult(logsDir, f, "failed", `vision:${currentId}`, currentId)
      appendNdjson(visionLog, {
        ts: isoNow(),
        status: "fail",
        source: f.rel,
        output: markitdownOutputRelPath(f.rel),
        engine: `vision:${currentId}`,
        pages: "",
        duration_s: 0,
        error: errMsg,
        model: currentId,
      })
      continue
    }

    const request = {
      providerID: parsed.providerID,
      modelID: parsed.modelID,
      prompt: VISION_TRANSCRIBE_PROMPT,
    }

    // Attempt transcription with retry, timeout, cancellation (per page).
    // A blank single image fails the file (TUI skip-flow); a blank PDF page
    // becomes a placeholder so one empty page never kills the document.
    let lastErr: unknown
    const pageTexts: string[] = []
    for (const [pageIdx, page] of pages.entries()) {
      throwIfSpinosaCancelled(shouldAbort)
      try {
        const pageLabel = pages.length > 1 ? `page ${pageIdx + 1}/${pages.length}` : "image"
        const text = await transcribeImagePayload(
          hooks.transcribeVision,
          request.providerID,
          request.modelID,
          currentId,
          page,
          f.rel,
          pageLabel,
          hooks.signal,
          shouldAbort,
          onLog,
        )
        pageTexts.push(text.trim())
        if (pages.length === 1 && !isPdfFile && !pageTexts[0]!.trim()) {
          throw new Error("Vision model returned no text")
        }
      } catch (e) {
        if (isSpinosaCancellationError(e)) throw e
        const msg = e instanceof Error ? e.message : String(e)
        if (pages.length > 1 && msg === "Vision model returned no text") {
          // One blank page must not kill the document — keep a placeholder.
          onLog?.(`  ${f.rel} → page ${pageIdx + 1}/${pages.length} returned no text — keeping placeholder`)
          pageTexts.push("[No text detected on this page]")
          continue
        }
        lastErr = e
        break
      }
    }

    let successText: string | undefined
    if (lastErr === undefined && pageTexts.length === pages.length) {
      if (pages.length === 1 && !isPdfFile) {
        successText = pageTexts[0]!.trim()
      } else {
        // PDF transcripts mirror the tesseract combine format (# title + ## Page N)
        const title = titleFromRel(f.rel)
        successText = `# ${title}\n\n${pageTexts.map((t, idx) => `## Page ${idx + 1}\n\n${t}`).join("\n\n")}\n`
      }
    }

    if (successText !== undefined) {
      try {
        throwIfSpinosaCancelled(shouldAbort)
        mkdirSync(path.dirname(f.dest), { recursive: true })
        writeTextAtomicSafe(f.dest, successText.trim() + "\n")
        injectColdFrontmatter(f.dest)
        if (pages.length > 1) {
          // Split pages for deep links (mirrors tesseract multi-page output)
          const title = titleFromRel(f.rel)
          const pageDir = f.dest.endsWith(".md") ? f.dest.slice(0, -3) : `${f.dest}_pages`
          try {
            rmSync(pageDir, { recursive: true, force: true })
            mkdirSync(pageDir, { recursive: true })
            for (const [i, text] of pageTexts.entries()) {
              const pageFile = path.join(pageDir, `page-${String(i + 1).padStart(3, "0")}.md`)
              writeTextAtomicSafe(
                pageFile,
                [
                  "---",
                  `source_document: "${path.basename(f.rel).replace(/"/g, '\\"')}"`,
                  `page: ${i + 1}`,
                  `page_count: ${pageTexts.length}`,
                  "---",
                  "",
                  `# ${title} - Page ${i + 1}`,
                  "",
                  text.trim() || "[No text detected on this page]",
                  "",
                ].join("\n"),
              )
              injectColdFrontmatter(pageFile)
            }
          } catch {}
        }
        converted++
        await emitDone(f.rel)
        recoverable.push({ src: f.src, dest: f.dest })
        recordVisionResult(logsDir, f, "done", `vision:${currentId}`, currentId)
        appendNdjson(visionLog, {
          ts: isoNow(),
          status: "ok",
          source: f.rel,
          output: markitdownOutputRelPath(f.rel),
          engine: `vision:${currentId}`,
          pages: isPdfFile ? String(pages.length) : "",
          duration_s: (Date.now() - startTime) / 1000,
          model: currentId,
        })
        continue
      } catch (err) {
        if (isSpinosaCancellationError(err)) throw err
        lastErr = err
      }
    }

    // Failure handling
    if (lastErr) {
      const rawErrMsg = lastErr instanceof Error ? lastErr.message : String(lastErr)
      const isAuth = isAuthError(rawErrMsg)
      let errMsg = rawErrMsg
      if (isAuth) {
        errMsg = `Authentication failed for ${parsed.providerID} (${currentId}) — your API key/token is invalid, expired, or revoked (${rawErrMsg.slice(0, 120)}). Please re-authenticate the provider via the provider menu.`
      }
      const visionHint = ` [vision:${currentId}]`
      onLog?.(`Vision failed: ${f.rel}${visionHint} — ${errMsg}`)
      if (isAuth) {
        onLog?.(`  Vision ${currentId} auth failed for ${f.rel} — open the provider menu to update credentials, then retry.`)
      } else {
        onLog?.(`  Vision ${currentId} error for ${f.rel} — ${errMsg} — Back to change model or pick Tesseract/copy`)
      }

      // Auth failure pause handling
      if (isAuth && hooks?.onVisionFailure) {
        try {
          const action = await hooks.onVisionFailure(f.rel, currentId, errMsg)
          if (action === "retry") {
            const newId = resolveVisionModelIdMemo()
            if (newId && newId !== currentId) {
              // New model = fresh attempt budget, not a blind retry loop.
              manualRetries.delete(f.rel)
              onLog?.(`  Retrying ${f.rel} with new vision model ${newId}…`)
            } else {
              onLog?.(`  Retrying ${f.rel}…`)
            }
            if (!noteManualRetry(f.rel)) {
              onLog?.(`  ${f.rel} → retry cap reached (${MAX_MANUAL_RETRIES}), marking failed`)
            } else {
              _idx--
              continue
            }
          } else if (action === "abort") {
            throw new SpinosaCancellationError("Vision failure abort requested")
          } else if (action === "skip") {
            // Fall through to fallback copy but count as failed
          }
        } catch (e) {
          if (isSpinosaCancellationError(e)) throw e
        }
      } else if (isAuth) {
        onLog?.(`  Vision ${currentId} auth failed — queue paused. Change vision model or re-authenticate.`)
        // Provide copy fallback but count as failed
        const fallbackDest = path.join(path.dirname(f.dest), path.basename(f.src))
        try {
          mkdirSync(path.dirname(fallbackDest), { recursive: true })
        } catch {}
        const ok = await safeCopyAsync(f.src, fallbackDest)
        if (ok) {
          recoverable.push({ src: f.src, dest: fallbackDest })
          appendNdjson(visionLog, {
            ts: isoNow(),
            status: "ok",
            source: f.rel,
            output: path.basename(fallbackDest),
            engine: "image-copy-fallback",
            pages: "",
            duration_s: 0,
            error: errMsg,
          })
          onLog?.(`  ${f.rel} → image copy fallback (auth missing — copied as-is)`)
        }
        failed++
        await emitDone(f.rel, "failed")
        // Failed even though a copy exists: no transcript yet, so resume retries.
        recordVisionResult(logsDir, f, "failed", `vision:${currentId}`, currentId)
        appendNdjson(visionLog, {
          ts: isoNow(),
          status: "fail",
          source: f.rel,
          output: markitdownOutputRelPath(f.rel),
          engine: `vision:${currentId}`,
          pages: "",
          duration_s: (Date.now() - startTime) / 1000,
          error: errMsg + visionHint,
          model: currentId,
        })
        continue
      }

      // For non-auth errors, offer retry via onVisionFailure as well
      if (hooks?.onVisionFailure && !isAuth) {
        try {
          const action = await hooks.onVisionFailure(f.rel, currentId, errMsg)
          if (action === "retry") {
            if (!noteManualRetry(f.rel)) {
              onLog?.(`  ${f.rel} → retry cap reached (${MAX_MANUAL_RETRIES}), marking failed`)
            } else {
              _idx--
              onLog?.(`  Retrying ${f.rel} with vision model ${currentId}…`)
              continue
            }
          } else if (action === "abort") {
            throw new SpinosaCancellationError("Vision failure abort requested")
          }
        } catch (e) {
          if (isSpinosaCancellationError(e)) throw e
        }
      }

      failed++
      await emitDone(f.rel, "failed")
      recordVisionResult(logsDir, f, "failed", `vision:${currentId}`, currentId)
      appendNdjson(visionLog, {
        ts: isoNow(),
        status: "fail",
        source: f.rel,
        output: markitdownOutputRelPath(f.rel),
        engine: `vision:${currentId}`,
        pages: "",
        duration_s: (Date.now() - startTime) / 1000,
        error: errMsg + visionHint,
        model: currentId,
      })
    } else {
      failed++
      await emitDone(f.rel, "failed")
      recordVisionResult(logsDir, f, "failed", `vision:${currentId}`, currentId)
    }
  }

  return { converted, skipped, failed, renamed: 0, recoverable }
}
