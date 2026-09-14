/**
 * Public surface of the single internal PDF subsystem.
 * Import from `@spinosa/core/pdf` (or relative `../pdf`) — never `pdfjs-dist`
 * directly outside `extension/pdf-js.ts` + this directory.
 */
export { openPdf, withPdfDocument } from "./document"
export { extractPageText, isUsableText, PDF_TEXT_EXTRACTION_FAILED_MARKER, type ClassifiedPdfPage } from "./text"
export { renderPage, PDF_RENDER_DPI_NORMAL, PDF_RENDER_DPI_RETRY, VISION_LONG_SIDE_PX, type RenderOptions } from "./render"
export { processPdf, type PdfPageOutcome } from "./process"
