/**
 * Product OCR platform gate — no local OCR engine ships.
 *
 * Text extraction is pdf.js (digital PDFs) + vision-model transcription
 * (scanned PDFs/images, user-selected provider) + copy-as-is. There is no
 * bundled OCR binary, so the platform gate reports unsupported with an
 * honest reason instead of failing closed on missing assets.
 */

export type OcrPlatformHints = {
  platform?: NodeJS.Platform
  arch?: string
}

/** Local OCR is removed — always false so doctor/TUI never wait on it. */
export function isOcrPlatformSupported(hints: OcrPlatformHints = {}): boolean {
  return false
}

/** Human reason when OCR must not load; always defined post-removal. */
export function ocrUnsupportedReason(hints: OcrPlatformHints = {}): string | undefined {
  return "Local OCR removed — pick a vision model to transcribe scans, or copy files as-is (digital PDFs still extract via pdf.js)"
}
