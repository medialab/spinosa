/**
 * Page-level text extraction for the internal PDF engine.
 * Parse once, extract embedded text per page, decide usable vs imageless.
 */
import stripAnsi from "strip-ansi"
import { PDF_TEXT_EXTRACTION_FAILED_MARKER } from "../extension/pdf-js"
import { withTimeout } from "../utils/timeout"
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs"

export { PDF_TEXT_EXTRACTION_FAILED_MARKER }

const PAGE_TIMEOUT_MS = 15_000

export async function extractPageText(doc: PDFDocumentProxy, page: number): Promise<string> {
  try {
    const pg = await withTimeout(doc.getPage(page), PAGE_TIMEOUT_MS)
    const content = await withTimeout(pg.getTextContent(), PAGE_TIMEOUT_MS)
    return stripAnsi(content.items.map((item) => ("str" in item ? (item as { str: string }).str : "")).join(" "))
  } catch {
    return PDF_TEXT_EXTRACTION_FAILED_MARKER
  }
}

/** A page has usable digital text when non-whitespace survives extraction. */
export function isUsableText(text: string): boolean {
  if (text === PDF_TEXT_EXTRACTION_FAILED_MARKER) return false
  return text.replace(/\s/g, "").length > 0
}

export type ClassifiedPdfPage =
  | { page: number; kind: "text"; text: string }
  | { page: number; kind: "image" }
  | { page: number; kind: "failed"; error: string }
