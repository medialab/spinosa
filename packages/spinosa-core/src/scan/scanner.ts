import { statSync } from "node:fs"
import { findSourceFiles, classifySourceFile } from "../extension/classifier"
import { fileExt } from "../constants"
import { resolveUserPath } from "../utils/path"
import { resolveWorkspacePath } from "../commands/create"
import type { ImportBatchManager } from "../import/batch"
import { probePdfjsRuntime, probeCanvasRuntime, probeMarkitdownRuntime } from "../tools/detection"
import { ocrUnsupportedReason } from "../tools/ocr-support"

export interface ScanCounts {
  markdown: number
  markitdown: number
  native: number
  binaryCopyable: number
  ocrConvertible: number
  video: number
  audio: number
  unknown: number
  ignored: number
  total: number
}

export interface ScanBytes {
  markdown: number
  markitdown: number
  native: number
  binaryCopyable: number
  ocrConvertible: number
  video: number
  audio: number
  unknown: number
}

export interface ToolStatus {
  markitdown: boolean
  ocr: boolean
  pdfjs: boolean
  canvas: boolean
  /** Present when OCR is gated off for this platform (not a failed probe). */
  ocrUnsupportedReason?: string
}

export interface OnboardingPreviewRow {
  label: string
  status: string
  detail?: string
  tone?: "ok" | "warn"
}

export async function scanSource(
  sourcePath: string,
  importBatches: ImportBatchManager,
): Promise<ScanCounts & ScanBytes & { files: string[] }> {
  const files: string[] = []
  const out = {
    markdown: 0,
    markitdown: 0,
    native: 0,
    binaryCopyable: 0,
    ocrConvertible: 0,
    video: 0,
    audio: 0,
    unknown: 0,
    ignored: 0,
    total: 0,
  } as ScanCounts & ScanBytes

  for (const fp of findSourceFiles(sourcePath)) {
    files.push(fp)
    const klass = await classifySourceFile(fp)

    if (klass === "ignored") {
      out.ignored++
      continue
    }

    out.total++
    // File can vanish or be replaced between the directory walk and here
    // (TOCTOU): a throw would abort the scan. Treat it like "unknown" instead.
    let sz: number
    try {
      sz = statSync(fp).size
    } catch {
      out.total--
      out.unknown++
      continue
    }
    const ext = fileExt(fp)

    switch (klass) {
      case "markdown":
        out.markdown++
        if (ext) importBatches.record(ext, sz)
        break
      case "markitdown":
        out.markitdown++
        if (ext) importBatches.record(ext, sz)
        break
      case "native":
        out.native++
        if (ext) importBatches.record(ext, sz)
        break
      case "binary_copyable":
        out.binaryCopyable++
        break
      case "ocr_convertible":
        out.ocrConvertible++
        if (ext) importBatches.record(ext, sz)
        break
      case "video":
        out.video++
        if (ext) importBatches.record(ext, sz)
        break
      case "audio":
        out.audio++
        if (ext) importBatches.record(ext, sz)
        break
      case "unknown":
        out.unknown++
        break
    }
  }

  importBatches.sort()
  importBatches.selectAll()

  return { ...out, files }
}

export async function detectDocumentTools(): Promise<ToolStatus> {
  // No local OCR engine ships: always report unavailable with the
  // removal reason. Vision/copy need nothing local; pdf.js handles digital PDFs.
  const unsupported = ocrUnsupportedReason()
  const [markitdown, pdfjs, canvas] = await Promise.all([
    probeMarkitdownRuntime(),
    probePdfjsRuntime(),
    probeCanvasRuntime(),
  ])
  return {
    markitdown,
    ocr: false,
    pdfjs,
    canvas,
    ...(unsupported ? { ocrUnsupportedReason: unsupported } : {}),
  }
}

export function suggestWorkspacePath(sourcePath: string): string | undefined {
  const resolved = resolveUserPath(sourcePath)
  if (!resolved) return undefined
  return resolveWorkspacePath(resolved)
}
