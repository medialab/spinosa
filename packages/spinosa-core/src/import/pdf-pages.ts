// Per-page PDF classification: which pages are digitally readable and which
// genuinely need vision/OCR (scans/photos).
//
// Rule (structural, no char-count threshold):
//   raster coverage >= IMAGE_COVERAGE_MIN → "image" (vision captures figures
//     AND any text on them; a folio number or caption never "proves" a full
//     photo page digital, or the image content would be silently lost)
//   below that                            → "text"  (direct extraction — even
//     for sparse pages and blanks; a profile photo on a text CV is not worth
//     a model call, and blanks cost nothing as placeholders)
//
// Error direction is deliberate throughout: unknown means vision. A wasted
// model call beats lost evidence.

import {
  withPdfDocument,
  pdfDocumentPageTextAndCoverage,
} from "../extension/pdf-js"
import { statSync } from "node:fs"

/**
 * Min page-area fraction covered by raster images to route a page to vision.
 * 40% keeps profile photos, icons, logos, and partial figures on the direct
 * path (their text is what matters); only image-dominated pages — scans,
 * full photos, figure plates — cost a vision call. Reference: a 219px CV
 * profile photo draws ~5.4%.
 */
export const IMAGE_COVERAGE_MIN = 0.4

export type PdfPageClass =
  | { page: number; kind: "text"; text: string }
  | { page: number; kind: "image" }

/** A document is direct-extractable only when every page was read successfully. */
export function isDigitalPdfPages(pages: readonly PdfPageClass[]): boolean {
  return pages.length > 0 && pages.every((page) => page.kind === "text") && pages.some((page) => page.kind === "text" && page.text.trim().length > 0)
}

/** Mixed PDFs need a hybrid pass only when there is actual embedded text to retain. */
export function hasEmbeddedTextPdfPages(pages: readonly PdfPageClass[]): boolean {
  return pages.some((page) => page.kind === "text" && page.text.trim().length > 0)
}

export function classifyPdfPage(
  page: number,
  text: string,
  imageCoverage: number,
  textExtractionFailed = false,
  minCoverage = IMAGE_COVERAGE_MIN,
): PdfPageClass {
  if (textExtractionFailed || imageCoverage >= minCoverage) return { page, kind: "image" }
  return { page, kind: "text", text }
}

export function partitionPdfPages(
  pages: readonly { page: number; text: string; imageCoverage: number }[],
  minCoverage: number = IMAGE_COVERAGE_MIN,
): PdfPageClass[] {
  return pages.map(({ page, text, imageCoverage }) => classifyPdfPage(page, text, imageCoverage, false, minCoverage))
}

export function pageTextsFromClassify(pages: readonly PdfPageClass[]): Array<{ page: number; text: string }> {
  return pages.map((page) => (page.kind === "text" ? { page: page.page, text: page.text } : { page: page.page, text: "" }))
}

type ClassifyCacheEntry = { mtimeMs: number; size: number; pages: PdfPageClass[] }
const classifyCache = new Map<string, ClassifyCacheEntry>()

function classifyFingerprint(srcFile: string): { mtimeMs: number; size: number } {
  try {
    const st = statSync(srcFile)
    return { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return { mtimeMs: 0, size: 0 }
  }
}

/** Classify every page via one shared pdf.js session. Throws on unreadable files. */
export async function classifyPdfPages(srcFile: string): Promise<PdfPageClass[]> {
  const fp = classifyFingerprint(srcFile)
  const hit = classifyCache.get(srcFile)
  if (hit && hit.mtimeMs === fp.mtimeMs && hit.size === fp.size) return hit.pages
  // One retry: under a loaded import run a healthy file can time out once.
  // Anything still failing after that is genuinely unreadable — callers fail
  // honestly instead of vision-transcribing the whole file blind.
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pages = await classifyPdfPagesOnce(srcFile)
      classifyCache.set(srcFile, { ...fp, pages })
      return pages
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function classifyPdfPagesOnce(srcFile: string): Promise<PdfPageClass[]> {
  return withPdfDocument(srcFile, async (doc) => {
    const out: PdfPageClass[] = []
    for (let page = 1; page <= doc.numPages; page++) {
      try {
        const { text, imageCoverage } = await pdfDocumentPageTextAndCoverage(doc, page)
        out.push(...partitionPdfPages([{ page, text, imageCoverage }]))
      } catch {
        // An unreadable page is not a blank page. Unknown pages go to OCR.
        out.push(classifyPdfPage(page, "", 0, true))
      }
    }
    return out
  })
}

/** Group 1-based page numbers into contiguous ranges (batch processing). */
export function contiguousRanges(pages: readonly number[]): Array<{ from: number; to: number }> {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const ranges: Array<{ from: number; to: number }> = []
  for (const page of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && page === last.to + 1) last.to = page
    else ranges.push({ from: page, to: page })
  }
  return ranges
}
