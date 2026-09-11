import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { safeCopyAsync, writeTextAtomicSafe } from "../utils/fs"
import { injectColdFrontmatter } from "./frontmatter"
import { SpinosaCancellationError, isSpinosaCancellationError, throwIfSpinosaCancelled } from "./cancellation"

type SpawnedProc = { exited: Promise<number>; kill: () => void; stderr?: unknown; stdout?: unknown }

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
  const env = process.env.TESSDATA_PREFIX
  return [
    ...(env ? [env] : []),
    "/opt/homebrew/share/tessdata",
    "/usr/local/share/tessdata",
    "/usr/share/tessdata",
    "/usr/share/tesseract-ocr/4.00/tessdata",
    "/usr/share/tesseract-ocr/5/tessdata",
    "/opt/local/share/tessdata",
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
    const hasTesseract = typeof Bun !== "undefined" && (Bun as unknown as { which?: (cmd: string) => string | null }).which
      ? !!(Bun as unknown as { which: (cmd: string) => string | null }).which!("tesseract")
      : false
    const hasPdftoppm = typeof Bun !== "undefined" && (Bun as unknown as { which?: (cmd: string) => string | null }).which
      ? !!(Bun as unknown as { which: (cmd: string) => string | null }).which!("pdftoppm")
      : false
    if (!hasTesseract || !hasPdftoppm) {
      _tesseractAvailable = false
      return _tesseractAvailable
    }
    // Check tessdata
    for (const base of tessdataCandidates()) {
      if (existsSync(base) && hasAllLangs(base)) {
        _tesseractAvailable = true
        return _tesseractAvailable
      }
    }
    // Fallback: if tesseract binary exists, assume langs are bundled (e.g. linux container)
    // Try a cheap spawn check: tesseract --list-langs includes needed langs
    try {
      const proc = Bun.spawnSync(["tesseract", "--list-langs"] as unknown as string[], {
        stdout: "pipe",
        stderr: "pipe",
      } as unknown as Parameters<typeof Bun.spawnSync>[1])
      const out = String((proc as unknown as { stdout: Uint8Array }).stdout ?? "") + String((proc as unknown as { stderr: Uint8Array }).stderr ?? "")
      if (out.includes("eng") && out.includes("ita") && out.includes("fra")) {
        _tesseractAvailable = true
        return _tesseractAvailable
      }
      // If custom tessdata path via env or default, still consider available if binary works
      // For product binaries without tessdata on host, we still claim available and let OCR fail per-file
      _tesseractAvailable = true
      return _tesseractAvailable
    } catch {
      _tesseractAvailable = true
      return _tesseractAvailable
    }
  } catch {
    _tesseractAvailable = false
    return _tesseractAvailable
  }
}

export function pdftoppmAvailable(): boolean {
  return tesseractAvailable()
}

export function networkImageAvailable(): boolean {
  // Placeholder for future network provider (e.g. cloud OCR)
  return false
}

export async function pdfHasTextLayer(pdfPath: string): Promise<boolean> {
  // Outcome-based: try MarkItDown, if it yields non-empty markdown → text layer
  try {
    const { MarkItDown } = await import("@spinosa/markitdown")
    const { markitdownConvertFile } = await import("./markitdown-convert")
    const converter = new MarkItDown()
    const result = await markitdownConvertFile(converter, pdfPath)
    const text = result?.markdown?.trim() ?? ""
    return text.length > 0
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
  options?: { shouldAbort?: () => boolean; onLog?: (line: string) => void; signal?: AbortSignal },
): Promise<TesseractOcrResult> {
  throwIfSpinosaCancelled(options?.shouldAbort)
  if (!tesseractAvailable()) throw new Error("tesseract not available (missing tesseract/pdftoppm or tessdata ita+eng+fra)")
  const title = titleFromRel(relPath)
  const tmpDir = await mkdtemp(path.join(tmpdir(), "spinosa-tess-"))
  try {
    const prefix = path.join(tmpDir, "page")
    // pdftoppm -png -r 300 pdf prefix
    let pdftoppmProc: SpawnedProc
    try {
      pdftoppmProc = Bun.spawn(["pdftoppm", "-png", "-r", "300", srcPath, prefix], {
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (err) {
      throw new Error(`pdftoppm spawn failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    const pdftoppmExit = await waitAbortableChild(pdftoppmProc, {
      shouldAbort: options?.shouldAbort,
      signal: options?.signal,
      label: `pdftoppm ${relPath}`,
    })
    if (pdftoppmExit !== 0) {
      const errText = await new Response(pdftoppmProc.stderr as unknown as ReadableStream).text().catch(() => "")
      throw new Error(`pdftoppm failed (exit ${pdftoppmExit}): ${errText.slice(0, 400)}`)
    }
    throwIfSpinosaCancelled(options?.shouldAbort)
    const pngs = readdirSync(tmpDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
    if (pngs.length === 0) throw new Error("pdftoppm produced no pages")
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
          ["tesseract", png, txtBase, "-l", "ita+eng+fra", "--psm", "6", "--oem", "1"],
          { stdout: "pipe", stderr: "pipe" },
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
      // Confidence via TSV (second pass, cheap for 300dpi single page)
      try {
        const tsvProc = Bun.spawn(
          ["tesseract", png, "stdout", "-l", "ita+eng+fra", "--psm", "6", "tsv"],
          { stdout: "pipe", stderr: "pipe" },
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
      await new Promise<void>((r) => setTimeout(r, 0))
    }
    // Per-page low confidence → garbaged placeholder (instead of whole-file discard)
    const totalWords = pageWordCounts.reduce((a, b) => a + b, 0)
    const avgConf = totalWords > 0 ? pageConfs.reduce((a, c, i) => a + c * pageWordCounts[i]!, 0) / totalWords : 0
    const totalLow = pageLowCounts.reduce((a, b) => a + b, 0)
    const lowPct = totalWords > 0 ? (totalLow / totalWords) * 100 : 100
    // Keep page PNGs for garbaged pages so further agents (network OCR) can work on them
    const pageImageDests: (string | null)[] = []
    for (let i = 0; i < pageTexts.length; i++) {
      const n = pageWordCounts[i] ?? 0
      const avg = pageConfs[i] ?? 0
      const low = pageLowCounts[i] ?? 0
      const lowPctPage = n > 0 ? (low / n) * 100 : 100
      const len = (pageTexts[i] ?? "").trim().length
      const isLow = n === 0 || avg < 60 || lowPctPage > 25 || len < 30
      if (isLow) {
        options?.onLog?.(`  ${relPath} page ${i + 1} low confidence (avg ${avg.toFixed(1)}, low ${lowPctPage.toFixed(1)}%, len ${len}) → [Garbaged] + keep image`)
        // Mark page as garbaged in markdown, keep image for network OCR
        const pngSrc = path.join(tmpDir, pngs[i]!)
        // Image dest: for single page → destFile.png, for multi → pageDir/page-001.png
        let imgDest: string | null = null
        if (pageTexts.length === 1) {
          imgDest = destFile.replace(/\.md$/, ".png")
        } else {
          const pageDir = destFile.endsWith(".md") ? destFile.slice(0, -3) : `${destFile}_pages`
          imgDest = path.join(pageDir, `page-${String(i + 1).padStart(3, "0")}.png`)
        }
        try {
          if (pngSrc && imgDest) {
            mkdirSync(path.dirname(imgDest), { recursive: true })
            const data = readFileSync(pngSrc)
            writeFileSync(imgDest, data)
            pageImageDests[i] = imgDest
          }
        } catch {}
        const imgRel = imgDest ? path.basename(imgDest) : `page-${String(i + 1).padStart(3, "0")}.png`
        // For single page, img is sibling of md; for multi, it's in pageDir
        const imgLink = pageTexts.length === 1 ? `./${path.basename(imgDest!)}` : `${path.basename(path.dirname(imgDest!))}/${imgRel}`
        pageTexts[i] = `[Garbaged — low confidence, original kept as image pending network OCR]\n\n![Page ${i + 1} original](${imgLink})`
      } else {
        pageImageDests[i] = null
      }
    }

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
    mkdirSync(path.dirname(destFile), { recursive: true })
    writeTextAtomicSafe(destFile, combined)
    injectColdFrontmatter(destFile)

    // Also write split pages (optional, extra navigability)
    if (pageTexts.length > 1) {
      const pageDir = destFile.endsWith(".md") ? destFile.slice(0, -3) : `${destFile}_pages`
      try {
        if (existsSync(pageDir)) rmSync(pageDir, { recursive: true, force: true })
        mkdirSync(pageDir, { recursive: true })
        for (let i = 0; i < pageTexts.length; i++) {
          const pageFile = path.join(pageDir, `page-${String(i + 1).padStart(3, "0")}.md`)
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

    return { mdPath: destFile, pages: pngs.length, text: combined, avgConf, lowPct }
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
