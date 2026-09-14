import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { safeCopyAsync, writeTextAtomicSafe } from "../utils/fs"
import { injectColdFrontmatter } from "./frontmatter"
import { SpinosaCancellationError, isSpinosaCancellationError, throwIfSpinosaCancelled } from "./cancellation"
import {
  bundledTessdataDir,
  bundledToolPath,
  resolveTesseract,
  verifyBundledTools,
} from "../distribution/tools"

type SpawnedProc = { exited: Promise<number>; kill: () => void; stderr?: unknown; stdout?: unknown }

/** Structured per-page OCR outcome. Failures never become successful text. */
export type PageOcrResult =
  | { status: "text"; text: string }
  | { status: "blank" }
  | { status: "failed"; error: string }

/**
 * Await a spawned child, killing it when cancellation flips (poll +
 * AbortSignal). Without this, cancelling mid-render leaves orphan CPU burn:
 * `throwIfSpinosaCancelled` between awaits never stops a running child.
 */
export async function waitAbortableChild(
  proc: SpawnedProc,
  opts?: { shouldAbort?: () => boolean; signal?: AbortSignal; label?: string },
): Promise<number> {
  if (opts?.shouldAbort?.() || opts?.signal?.aborted) {
    try { proc.kill() } catch {}
    throw new SpinosaCancellationError(`${opts?.label ?? "child process"} cancelled`)
  }
  if (!opts?.shouldAbort && !opts?.signal) return proc.exited
  return await new Promise<number>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearInterval(timer)
      opts?.signal?.removeEventListener("abort", onAbort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      try { proc.kill() } catch {}
      reject(new SpinosaCancellationError(`${opts?.label ?? "child process"} cancelled`))
    }
    const onAbort = () => abort()
    const timer = setInterval(() => {
      if (opts?.shouldAbort?.() || opts?.signal?.aborted) abort()
    }, 200)
    opts?.signal?.addEventListener("abort", onAbort, { once: true })
    proc.exited.then(
      (code) => { if (!settled) { settled = true; cleanup(); resolve(code) } },
      (err) => { if (!settled) { settled = true; cleanup(); reject(err) } },
    )
  })
}

let _tesseractAvailable: boolean | undefined

function tessdataCandidates(): string[] {
  // Standalone contract: only Spinosa-owned locations — the bundled tools dir
  // and an explicit TESSDATA_PREFIX. Never host-system install locations:
  // the shipped binary must not depend on, or even probe, paths outside
  // $SPINOSA_HOME and explicit env overrides.
  const bundled = bundledTessdataDir()
  const env = process.env.TESSDATA_PREFIX
  return [
    ...(bundled ? [bundled] : []),
    ...(env ? [env] : []),
  ]
}

function hasAllLangs(base: string): boolean {
  return ["eng.traineddata", "ita.traineddata", "fra.traineddata"].every((f) =>
    existsSync(path.join(base, f)),
  )
}

export function tesseractAvailable(): boolean {
  if (_tesseractAvailable !== undefined) return _tesseractAvailable
  try {
    // Production: bundled Spinosa-owned Tesseract + tessdata first.
    const bundled = bundledToolPath("tesseract")
    const tessdata = bundledTessdataDir()
    if (bundled && tessdata) {
      _tesseractAvailable = true
      return _tesseractAvailable
    }
    // Developer-only fallback behind an explicit flag. Never PATH-sniff in
    // production (no Bun.which("tesseract") as the dependency mechanism).
    if (process.env.SPINOSA_DEV_HOST_TOOLS === "1" && typeof Bun !== "undefined") {
      const which = (Bun as unknown as { which?: (cmd: string) => string | null }).which
      if (which?.("tesseract")) {
        for (const base of tessdataCandidates()) {
          if (existsSync(base) && hasAllLangs(base)) {
            _tesseractAvailable = true
            return _tesseractAvailable
          }
        }
      }
    }
    _tesseractAvailable = false
    return _tesseractAvailable
  } catch {
    _tesseractAvailable = false
    return _tesseractAvailable
  }
}

/**
 * @deprecated Poppler/pdftoppm is NOT a production dependency: the internal
 * PDF engine (pdf.js + Canvas) renders pages to in-memory buffers. Always
 * returns false so legacy call sites fail safe instead of shelling to a host
 * binary.
 */
export function pdftoppmAvailable(): boolean {
  return false
}

/** Unavailable-asset detail for doctor/logs (fail-closed messaging). */
export function tesseractMissingDetail(): string[] {
  return verifyBundledTools()
}

export function networkImageAvailable(): boolean {
  // Placeholder for future network provider (e.g. cloud OCR)
  return false
}

export async function pdfHasTextLayer(pdfPath: string): Promise<boolean> {
  // Single PDF subsystem: probe embedded text via the internal engine.
  // MarkItDown must never process PDFs (office formats only).
  try {
    const { withPdfDocument } = await import("../extension/pdf-js")
    const { pdfDocumentPageHasExtractableText } = await import("../extension/pdf-js")
    return await withPdfDocument(pdfPath, async (doc) => {
      for (let page = 1; page <= doc.numPages; page++) {
        try {
          if (await pdfDocumentPageHasExtractableText(doc, page)) return true
        } catch {
          continue
        }
      }
      return false
    })
  } catch {
    return false
  }
}

function titleFromRel(rel: string): string {
  const stem = path.basename(rel, path.extname(rel))
  return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || stem
}

function cleanOcrBody(body: string): string {
  // Strip empty artefacts, preserve unicode
  let cleaned = body.trim()
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n")
  return cleaned || "[No text detected]"
}

/**
 * OCR a subset of PDF pages (1-based) via the internal renderer
 * (pdf.js + Canvas → in-memory PNG → bundled Tesseract).
 * Text-bearing pages are handled by direct extraction upstream, so tesseract
 * only ever sees imageless pages. Returns cleaned text per successfully OCR'd
 * page (missing entries mean render/OCR failure — never placeholder text).
 */
export type PdfOcrPageTick = (page: number, total: number) => void | Promise<void>

function tesseractEnv(): Record<string, string | undefined> {
  const tessdata = bundledTessdataDir()
  if (tessdata && !process.env.TESSDATA_PREFIX) {
    return { ...process.env, TESSDATA_PREFIX: tessdata }
  }
  return { ...process.env }
}

export async function ocrPdfPagesViaTesseract(
  srcPath: string,
  pages: readonly number[],
  relPath: string,
  options?: { shouldAbort?: () => boolean; onLog?: (line: string) => void; signal?: AbortSignal; onPage?: PdfOcrPageTick; pageTotal?: number },
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const wanted = [...new Set(pages)].filter((p) => Number.isFinite(p) && p >= 1)
  if (wanted.length === 0) return out
  throwIfSpinosaCancelled(options?.shouldAbort)
  if (!tesseractAvailable()) {
    throw new Error(`Bundled Tesseract is unavailable (missing: ${tesseractMissingDetail().join(", ") || "unknown"})`)
  }
  const tesseractBin = resolveTesseract()
  const { withPdfDocument } = await import("../extension/pdf-js")
  const { renderPage } = await import("../pdf/render")
  // Private temp dir for the tesseract CLI file interface (0700 via mkdtemp).
  const { mkdtemp: mkdtempAsync } = await import("node:fs/promises")
  const tmpDir = await mkdtempAsync(path.join(tmpdir(), "spinosa-tess-"))
  try {
    options?.onLog?.(`  ${relPath} → rendering ${wanted.length} page${wanted.length === 1 ? "" : "s"} (${wanted.join(", ")}) for tesseract OCR ...`)
    const pngByPage = new Map<number, string>()
    await withPdfDocument(srcPath, async (doc) => {
      for (const page of [...wanted].sort((a, b) => a - b)) {
        throwIfSpinosaCancelled(options?.shouldAbort)
        if (options?.signal?.aborted) throw new SpinosaCancellationError(`tesseract ${relPath} cancelled`)
        let png: Buffer
        try {
          png = await renderPage(doc, page)
        } catch (err) {
          options?.onLog?.(`  ${relPath} page ${page} internal render failed: ${err instanceof Error ? err.message : String(err)}`)
          continue
        }
        // Adaptive retry: empty first pass at ~200 DPI → retry at ~300 DPI.
        const pngPath = path.join(tmpDir, `page-${page}.png`)
        writeFileSync(pngPath, png)
        pngByPage.set(page, pngPath)
      }
    })
    const env = tesseractEnv()
    for (const page of [...pngByPage.keys()].sort((a, b) => a - b)) {
      throwIfSpinosaCancelled(options?.shouldAbort)
      const pngPath = pngByPage.get(page)!
      const txtBase = path.join(tmpDir, `out-${page}`)
      const tessProc = Bun.spawn(
        [tesseractBin, pngPath, txtBase, "-l", "ita+eng+fra", "--psm", "6", "--oem", "1"],
        { stdout: "pipe", stderr: "pipe", env },
      )
      const exit = await waitAbortableChild(tessProc, {
        shouldAbort: options?.shouldAbort,
        signal: options?.signal,
        label: `tesseract ${relPath} page ${page}`,
      })
      const txtPath = `${txtBase}.txt`
      let pageText = ""
      try {
        pageText = existsSync(txtPath) ? readFileSync(txtPath, "utf-8") : ""
      } catch {
        pageText = ""
      }
      if (exit !== 0 && !pageText.trim()) {
        const errText = await new Response(tessProc.stderr as unknown as ReadableStream).text().catch(() => "")
        options?.onLog?.(`  ${relPath} page ${page} tesseract failed (exit ${exit}): ${errText.slice(0, 200)}`)
        continue
      }
      if (!pageText.trim()) {
        // Blank page: record explicit blank (not failure, not success-text).
        out.set(page, "")
        await options?.onPage?.(page, options?.pageTotal ?? wanted.length)
        continue
      }
      out.set(page, cleanOcrBody(pageText))
      await options?.onPage?.(page, options?.pageTotal ?? wanted.length)
      await new Promise<void>((r) => setTimeout(r, 0))
    }
    return out
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch { /* cleanup */ }
  }
}

/** Structured wrapper: text/blank/failed per requested page. */
export async function ocrPdfPagesStructured(
  srcPath: string,
  pages: readonly number[],
  relPath: string,
  options?: { shouldAbort?: () => boolean; onLog?: (line: string) => void; signal?: AbortSignal },
): Promise<Map<number, PageOcrResult>> {
  const wanted = [...new Set(pages)].filter((p) => Number.isFinite(p) && p >= 1)
  const out = new Map<number, PageOcrResult>()
  if (wanted.length === 0) return out
  let texts: Map<number, string>
  try {
    texts = await ocrPdfPagesViaTesseract(srcPath, wanted, relPath, options)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    for (const p of wanted) out.set(p, { status: "failed", error: msg })
    return out
  }
  for (const p of wanted) {
    const t = texts.get(p)
    if (t === undefined) out.set(p, { status: "failed", error: "render or OCR failed" })
    else if (!t.trim()) out.set(p, { status: "blank" })
    else out.set(p, { status: "text", text: t })
  }
  return out
}

/**
 * Hybrid PDF conversion for mixed documents: pages with embedded digital
 * text keep direct extraction; only imageless pages go through tesseract.
 * Output format mirrors ocrPdfViaTesseract (title + ## Page N + page splits
 * with frontmatter) so downstream is identical. Returns OCR'd page count.
 */
export async function convertPdfHybridTesseract(
  srcFile: string,
  destFile: string,
  relPath: string,
  classes: readonly { page: number; kind: string; text?: string }[],
  options?: { shouldAbort?: () => boolean; onLog?: (line: string) => void; signal?: AbortSignal; onPage?: PdfOcrPageTick },
): Promise<{ pages: number; ocrPages: number; destFile: string }> {
  const title = titleFromRel(relPath)
  const total = classes.length > 0 ? Math.max(...classes.map((c) => c.page)) : 0
  if (total === 0) throw new Error("no pages to convert")
  const direct = new Map<number, string>()
  const imagePages: number[] = []
  for (const c of classes) {
    if (c.kind === "text" && typeof c.text === "string") direct.set(c.page, c.text)
    else imagePages.push(c.page)
  }
  throwIfSpinosaCancelled(options?.shouldAbort)
  if (imagePages.length > 0) {
    options?.onLog?.(`  ${relPath} → ${direct.size}/${total} pages have embedded text, tesseract transcribes ${imagePages.length} imageless page(s) ...`)
  }
  const ocr = await ocrPdfPagesViaTesseract(srcFile, imagePages, relPath, { ...options, pageTotal: total })
  // Structured outcomes: direct text wins; OCR text wins; blank stays an
  // explicit blank; MISSING OCR entries are failures (never success text).
  // Callers must treat failed pages as unresolved (partial/failed), not done.
  const failedOcrPages: number[] = []
  const pageTexts: string[] = []
  for (let p = 1; p <= total; p++) {
    const d = direct.get(p)
    if (d !== undefined) pageTexts.push(d.trim())
    else if (ocr.has(p)) {
      const t = (ocr.get(p) ?? "").trim()
      pageTexts.push(t || "[Blank page — no text detected]")
    } else {
      failedOcrPages.push(p)
      pageTexts.push("[Page OCR failed — pending retry]")
    }
  }
  if (failedOcrPages.length > 0) {
    throw new Error(`tesseract OCR failed on pages ${failedOcrPages.join(", ")} — refusing to mark done with unresolved pages`)
  }
  const combined = `# ${title}\n\n${pageTexts.map((t, idx) => `## Page ${idx + 1}\n\n${t}`).join("\n\n")}\n`
  mkdirSync(path.dirname(destFile), { recursive: true })
  // Truncation-safe: everything downstream (splits, images, callers) must use
  // the path actually written, not the requested one (finding: ENAMETOOLONG
  // reported "no output" while a truncated file sat on disk).
  const actualDest = writeTextAtomicSafe(destFile, combined)
  injectColdFrontmatter(actualDest)
  if (pageTexts.length > 1) {
    const pageDir = actualDest.endsWith(".md") ? actualDest.slice(0, -3) : `${actualDest}_pages`
    try {
      if (existsSync(pageDir)) rmSync(pageDir, { recursive: true, force: true })
      mkdirSync(pageDir, { recursive: true })
      for (const [i, text] of pageTexts.entries()) {
        const pageFile = path.join(pageDir, `page-${String(i + 1).padStart(3, "0")}.md`)
        writeTextAtomicSafe(
          pageFile,
          [
            "---",
            `source_document: "${path.basename(relPath).replace(/"/g, '\\"')}"`,
            `page: ${i + 1}`,
            `page_count: ${pageTexts.length}`,
            "---",
            "",
            `# ${title} - Page ${i + 1}`,
            "",
            text.trim() || "[Blank page — no text detected]",
            "",
          ].join("\n"),
        )
        injectColdFrontmatter(pageFile)
      }
    } catch {
      // ignore split page failures
    }
  }
  return { pages: total, ocrPages: imagePages.length, destFile: actualDest }
}

export class TesseractLowConfidenceError extends Error {
  constructor(
    message: string,
    public readonly avgConf: number,
    public readonly lowPct: number,
    public readonly textLen: number,
  ) {
    super(message)
    this.name = "TesseractLowConfidenceError"
  }
}

export interface TesseractOcrResult {
  mdPath: string
  pages: number
  text: string
  avgConf: number
  lowPct: number
}

export async function ocrPdfViaTesseract(
  srcPath: string,
  destFile: string,
  relPath: string,
  options?: { shouldAbort?: () => boolean; onLog?: (line: string) => void; signal?: AbortSignal; onPage?: PdfOcrPageTick },
): Promise<TesseractOcrResult> {
  throwIfSpinosaCancelled(options?.shouldAbort)
  if (!tesseractAvailable()) {
    throw new Error(`Bundled Tesseract is unavailable (missing: ${tesseractMissingDetail().join(", ") || "unknown"})`)
  }
  const title = titleFromRel(relPath)
  const tesseractBin = resolveTesseract()
  const env = tesseractEnv()
  const tmpDir = await mkdtemp(path.join(tmpdir(), "spinosa-tess-"))
  try {
    // Internal renderer (pdf.js + Canvas): open once, render each page to a
    // buffer, spill to private temp PNGs only for the tesseract CLI.
    const { withPdfDocument } = await import("../extension/pdf-js")
    const { renderPage } = await import("../pdf/render")
    const pngPaths: string[] = []
    await withPdfDocument(srcPath, async (doc) => {
      for (let page = 1; page <= doc.numPages; page++) {
        throwIfSpinosaCancelled(options?.shouldAbort)
        const png = await renderPage(doc, page)
        const pngPath = path.join(tmpDir, `page-${page}.png`)
        writeFileSync(pngPath, png)
        pngPaths.push(pngPath)
      }
    })
    throwIfSpinosaCancelled(options?.shouldAbort)
    const pngs = pngPaths.map((p) => path.basename(p)).sort()
    if (pngs.length === 0) throw new Error("internal PDF renderer produced no pages")
    options?.onLog?.(`  ${relPath} → splitting into ${pngs.length} page${pngs.length === 1 ? "" : "s"}, extracting text via tesseract OCR ...`)
    const pageTexts: string[] = []
    const pageConfs: number[] = []
    const pageLowCounts: number[] = []
    const pageWordCounts: number[] = []
    for (let i = 0; i < pngs.length; i++) {
      throwIfSpinosaCancelled(options?.shouldAbort)
      const png = path.join(tmpDir, pngs[i]!)
      const txtBase = path.join(tmpDir, `out-${i}`)
      let tessProc: SpawnedProc
      try {
        tessProc = Bun.spawn(
          [tesseractBin, png, txtBase, "-l", "ita+eng+fra", "--psm", "6", "--oem", "1"],
          { stdout: "pipe", stderr: "pipe", env },
        )
      } catch (err) {
        throw new Error(`tesseract spawn failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      const tessExit = await waitAbortableChild(tessProc, {
        shouldAbort: options?.shouldAbort,
        signal: options?.signal,
        label: `tesseract ${relPath} page ${i + 1}`,
      })
      // tesseract writes txtBase.txt even on empty; read it
      const txtPath = `${txtBase}.txt`
      let pageText = ""
      try {
        pageText = existsSync(txtPath) ? readFileSync(txtPath, "utf-8") : ""
      } catch {
        pageText = ""
      }
      if (tessExit !== 0 && !pageText.trim()) {
        const errText = await new Response(tessProc.stderr as unknown as ReadableStream).text().catch(() => "")
        options?.onLog?.(`  ${relPath} page ${i + 1} tesseract exit ${tessExit}: ${errText.slice(0, 200)}`)
      }
      pageTexts.push(cleanOcrBody(pageText))
      // Confidence via TSV (second pass, cheap for single page)
      try {
        const tsvProc = Bun.spawn(
          [tesseractBin, png, "stdout", "-l", "ita+eng+fra", "--psm", "6", "tsv"],
          { stdout: "pipe", stderr: "pipe", env },
        )
        const [tsvText] = await Promise.all([
          new Response(tsvProc.stdout as unknown as ReadableStream).text(),
          waitAbortableChild(tsvProc, {
            shouldAbort: options?.shouldAbort,
            signal: options?.signal,
            label: `tesseract-tsv ${relPath} page ${i + 1}`,
          }),
        ])
        const lines = tsvText.split("\n").slice(1) // skip header
        let sum = 0, n = 0, low = 0
        for (const line of lines) {
          if (!line.trim()) continue
          const cols = line.split("\t")
          const conf = Number(cols[10])
          const text = cols[11] ?? ""
          if (Number.isNaN(conf) || conf < 0) continue
          if (!text.trim()) continue
          sum += conf
          n++
          if (conf < 30) low++
        }
        if (n > 0) {
          pageConfs.push(sum / n)
          pageLowCounts.push(low)
          pageWordCounts.push(n)
        } else {
          pageConfs.push(0)
          pageLowCounts.push(0)
          pageWordCounts.push(0)
        }
      } catch (err) {
        // Cancellation must propagate — swallowing it here would mark a
        // cancelled file converted on the last page.
        if (isSpinosaCancellationError(err)) throw err
        pageConfs.push(0)
        pageLowCounts.push(0)
        pageWordCounts.push(0)
      }
      // Yield to event loop so TUI can paint
      await options?.onPage?.(i + 1, pngs.length)
      await new Promise<void>((r) => setTimeout(r, 0))
    }
    // Per-page low confidence → garbaged placeholder (instead of whole-file discard)
    const totalWords = pageWordCounts.reduce((a, b) => a + b, 0)
    const avgConf = totalWords > 0 ? pageConfs.reduce((a, c, i) => a + c * pageWordCounts[i]!, 0) / totalWords : 0
    const totalLow = pageLowCounts.reduce((a, b) => a + b, 0)
    const lowPct = totalWords > 0 ? (totalLow / totalWords) * 100 : 100
    // Combined dest first: image/split paths below derive from the path
    // actually written (truncation-safe), never the requested one.
    let combined: string
    if (pageTexts.length === 1) {
      combined = `# ${title}\n\n${pageTexts[0]}\n`
    } else {
      // For multi-page, write single md with page separators
      // Spec says concat → single md; we keep simple concat with separators
      const pagesWithHeader = pageTexts
        .map((t, idx) => `## Page ${idx + 1}\n\n${t}`)
        .join("\n\n")
      combined = `# ${title}\n\n${pagesWithHeader}\n`
    }
    // Keep page PNGs for garbaged pages so further agents (network OCR) can work on them
    const garbaged = new Set<number>()
    for (let i = 0; i < pageTexts.length; i++) {
      const n = pageWordCounts[i] ?? 0
      const avg = pageConfs[i] ?? 0
      const low = pageLowCounts[i] ?? 0
      const lowPctPage = n > 0 ? (low / n) * 100 : 100
      const len = (pageTexts[i] ?? "").trim().length
      const isLow = n === 0 || avg < 60 || lowPctPage > 25 || len < 30
      if (isLow) {
        options?.onLog?.(`  ${relPath} page ${i + 1} low confidence (avg ${avg.toFixed(1)}, low ${lowPctPage.toFixed(1)}%, len ${len}) → [Garbaged] + keep image`)
        garbaged.add(i)
      }
    }

    mkdirSync(path.dirname(destFile), { recursive: true })
    const actualDest = writeTextAtomicSafe(destFile, combined)
    injectColdFrontmatter(actualDest)

    // Image dest: for single page → sibling .png, for multi → pageDir/page-001.png
    const actualPageDir = actualDest.endsWith(".md") ? actualDest.slice(0, -3) : `${actualDest}_pages`
    for (const i of garbaged) {
      const pngSrc = path.join(tmpDir, pngs[i]!)
      const imgDest = pageTexts.length === 1
        ? actualDest.replace(/\.md$/, ".png")
        : path.join(actualPageDir, `page-${String(i + 1).padStart(3, "0")}.png`)
      try {
        if (pngSrc && imgDest) {
          mkdirSync(path.dirname(imgDest), { recursive: true })
          const data = readFileSync(pngSrc)
          writeFileSync(imgDest, data)
        }
      } catch {}
      const imgRel = path.basename(imgDest)
      // For single page, img is sibling of md; for multi, it's in pageDir
      const imgLink = pageTexts.length === 1 ? `./${imgRel}` : `${path.basename(actualPageDir)}/${imgRel}`
      pageTexts[i] = `[Garbaged — low confidence, original kept as image pending network OCR]\n\n![Page ${i + 1} original](${imgLink})`
    }
    if (garbaged.size > 0) {
      // Rewrite with garbaged placeholders now that image links are known.
      let rewritten: string
      if (pageTexts.length === 1) {
        rewritten = `# ${title}\n\n${pageTexts[0]}\n`
      } else {
        rewritten = `# ${title}\n\n${pageTexts.map((t, idx) => `## Page ${idx + 1}\n\n${t}`).join("\n\n")}\n`
      }
      writeTextAtomicSafe(actualDest, rewritten)
      combined = rewritten
    }

    // Also write split pages (optional, extra navigability)
    if (pageTexts.length > 1) {
      try {
        if (existsSync(actualPageDir)) rmSync(actualPageDir, { recursive: true, force: true })
        mkdirSync(actualPageDir, { recursive: true })
        for (let i = 0; i < pageTexts.length; i++) {
          const pageFile = path.join(actualPageDir, `page-${String(i + 1).padStart(3, "0")}.md`)
          const pageContent = [
            "---",
            `source_document: "${path.basename(relPath).replace(/"/g, '\\"')}"`,
            `page: ${i + 1}`,
            `page_count: ${pageTexts.length}`,
            "---",
            "",
            `# ${title} - Page ${i + 1}`,
            "",
            pageTexts[i] || "[No text detected on this page]",
            "",
          ].join("\n")
          writeTextAtomicSafe(pageFile, pageContent)
          injectColdFrontmatter(pageFile)
        }
        // Keep root as concatenated text; page dir remains for deep links
      } catch {
        // ignore split page failures
      }
    }

    return { mdPath: actualDest, pages: pngs.length, text: combined, avgConf, lowPct }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch { /* cleanup */ }
  }
}

export async function copyImageAsIs(
  srcPath: string,
  destPath: string,
  relPath?: string,
  options?: { shouldAbort?: () => boolean; onLog?: (line: string) => void },
): Promise<boolean> {
  throwIfSpinosaCancelled(options?.shouldAbort)
  const ok = await safeCopyAsync(srcPath, destPath)
  if (!ok) return false
  // Images are binary — no frontmatter injection. Tagging is via workspace_index Skipped Media
  // and via returned copy count. For traceability, write a sidecar .pending? We keep it simple.
  options?.onLog?.(`  ${relPath ?? path.basename(srcPath)} → copied for network OCR (pending)`)
  return true
}

// Test helper to reset cache
export function _resetTesseractAvailableCache(): void {
  _tesseractAvailable = undefined
}
