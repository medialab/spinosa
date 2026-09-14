/**
 * Adaptive page rendering for the internal PDF engine.
 * pdf.js + @napi-rs/canvas → in-memory PNG buffer. No pdftoppm/Poppler, no
 * temp PNG files in the hot path (callers may spill to a private temp dir
 * only when a child process needs a file path.
 *
 * Policy (benchmark-tunable):
 *   normal document        → ~200 DPI
 *   poor OCR / small text  → retry ~300 DPI
 *   vision model           → long side ~2200 px
 */
import { pdfRenderDocumentPageToPng } from "../extension/pdf-js"
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs"

export const PDF_RENDER_DPI_NORMAL = 200
export const PDF_RENDER_DPI_RETRY = 300
export const VISION_LONG_SIDE_PX = 2200

export type RenderOptions = {
  /** Explicit DPI (overrides preset). */
  dpi?: number
  /** Vision preset: scale so the long side ≈ VISION_LONG_SIDE_PX. */
  forVision?: boolean
  /** Retry pass after poor OCR confidence. */
  retry?: boolean
}

export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  options?: RenderOptions,
): Promise<Buffer> {
  if (options?.forVision) {
    const pg = await doc.getPage(pageNumber)
    try {
      const v1 = pg.getViewport({ scale: 1 })
      const longSide = Math.max(v1.width, v1.height)
      const scale = longSide > 0 ? VISION_LONG_SIDE_PX / longSide : VISION_LONG_SIDE_PX / 612
      const dpi = Math.max(72, Math.min(300, Math.round(72 * scale)))
      return pdfRenderDocumentPageToPng(doc, pageNumber, dpi)
    } finally {
      try { await (pg as unknown as { cleanup?: () => void }).cleanup?.() } catch {}
    }
  }
  const dpi = options?.dpi ?? (options?.retry ? PDF_RENDER_DPI_RETRY : PDF_RENDER_DPI_NORMAL)
  return pdfRenderDocumentPageToPng(doc, pageNumber, dpi)
}
