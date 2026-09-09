import { statSync, existsSync } from "node:fs"
import * as path from "node:path"
import { findSourceFiles, classifySourceFile } from "../extension/classifier"
import { fileExt } from "../constants"
import { resolveUserPath } from "../utils/path"
import type { ImportBatchManager } from "../import/batch"
import { moduleAvailable, ocrAvailable, pdfjsAvailable, tesseractAvailable } from "../tools/detection"
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
): Promise<ScanCounts & ScanBytes> {
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

  return out
}

export async function detectDocumentTools(): Promise<ToolStatus> {
  const hasTesseract = tesseractAvailable()
  const unsupported = hasTesseract ? undefined : ocrUnsupportedReason()
  // Fork is @spinosa/markitdown; keep markitdown-ts as fallback for availability
  const hasMarkitdown = checkModuleAvailable("@spinosa/markitdown") || checkModuleAvailable("markitdown-ts")
  return {
    markitdown: hasMarkitdown,
    ocr: ocrAvailable(),
    pdfjs: pdfjsAvailable(),
    ...(unsupported ? { ocrUnsupportedReason: unsupported } : {}),
  }
}

function checkModuleAvailable(name: string): boolean {
  return moduleAvailable(name, name === "@spinosa/markitdown" || name === "markitdown-ts")
}

export function suggestWorkspacePath(sourcePath: string): string | undefined {
  const resolved = resolveUserPath(sourcePath)
  if (!resolved) return undefined
  const corpusName = path.basename(resolved)
  const parentDir = path.dirname(resolved)
  const base = path.join(parentDir, `${corpusName}-spinosa`)
  let candidate = base
  let index = 2
  while (existsSync(candidate)) {
    candidate = `${base}-${index}`
    index++
  }
  return candidate
}
