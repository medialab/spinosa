/**
 * Internal PDF document abstraction — the ONLY production PDF entry point.
 *
 * Architecture:
 *   PDF → pdf.js → page → embedded text | Canvas image buffer → Tesseract/Vision
 *
 * No other production subsystem may import `pdfjs-dist` directly. Open once,
 * iterate pages in order, render imageless pages internally (no pdftoppm, no
 * Poppler, no physical page-*.pdf splits).
 */
import { readFile } from "node:fs/promises"
import {
  bufferToPdfJsUint8Array,
  pdfDocLoadTimeoutMs,
  withPdfDocument,
  type PDF_PAGE_TIMEOUT_MS,
} from "../extension/pdf-js"

export type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs"

export async function openPdf(file: string): Promise<{ data: Uint8Array; sizeBytes: number }> {
  const buf = await readFile(file)
  return { data: bufferToPdfJsUint8Array(buf), sizeBytes: buf.byteLength }
}

export function pdfLoadBudgetMs(sizeBytes: number): number {
  return pdfDocLoadTimeoutMs(sizeBytes)
}

export { withPdfDocument }
export type { PDF_PAGE_TIMEOUT_MS }
