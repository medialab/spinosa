import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { safeCopyAsync, writeTextAtomicSafe } from "../utils/fs"
import { injectColdFrontmatter } from "./frontmatter"
import { throwIfSpinosaCancelled } from "./cancellation"

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
    const { MarkItDown } = await import("markitdown-ts")
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

export interface TesseractOcrResult {
  mdPath: string
  pages: number
  text: string
}

export async function ocrPdfViaTesseract(
  srcPath: string,
  destFile: string,
  relPath: string,
  options?: { shouldAbort?: () => boolean; onLog?: (line: string) => void },
): Promise<TesseractOcrResult> {
  throwIfSpinosaCancelled(options?.shouldAbort)
  if (!tesseractAvailable()) throw new Error("tesseract not available (missing tesseract/pdftoppm or tessdata ita+eng+fra)")
  const title = titleFromRel(relPath)
  const tmpDir = await mkdtemp(path.join(tmpdir(), "spinosa-tess-"))
  try {
    const prefix = path.join(tmpDir, "page")
    // pdftoppm -png -r 300 pdf prefix
    const pdftoppmProc = Bun.spawn(["pdftoppm", "-png", "-r", "300", srcPath, prefix], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const pdftoppmExit = await pdftoppmProc.exited
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
    for (let i = 0; i < pngs.length; i++) {
      throwIfSpinosaCancelled(options?.shouldAbort)
      const png = path.join(tmpDir, pngs[i]!)
      const txtBase = path.join(tmpDir, `out-${i}`)
      const tessProc = Bun.spawn(
        ["tesseract", png, txtBase, "-l", "ita+eng+fra", "--psm", "6", "--oem", "1"],
        { stdout: "pipe", stderr: "pipe" },
      )
      const tessExit = await tessProc.exited
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
      // Yield to event loop so TUI can paint
      await new Promise<void>((r) => setTimeout(r, 0))
    }

    let combined: string
    if (pageTexts.length === 1) {
      combined = `# ${title}\n\n${pageTexts[0]}\n`
    } else {
      // For multi-page, write single md with page separators and also split pages like ppu does?
      // Spec says concat → single md; we keep simple concat with separators
      const pagesWithHeader = pageTexts
        .map((t, idx) => `## Page ${idx + 1}\n\n${t}`)
        .join("\n\n")
      combined = `# ${title}\n\n${pagesWithHeader}\n`
    }
    mkdirSync(path.dirname(destFile), { recursive: true })
    writeTextAtomicSafe(destFile, combined)
    injectColdFrontmatter(destFile)

    // Also write split pages for consistency with ppu output (optional, not required by spec)
    // Keep single-file behavior primary; split dir is extra navigability
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
        // Replace root with index linking to pages (like ppu do) while preserving OCR text?
        // Keep root as concatenated text; page dir remains for deep links
      } catch {
        // ignore split page failures
      }
    }

    return { mdPath: destFile, pages: pngs.length, text: combined }
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
