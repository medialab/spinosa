/**
 * Product OCR (tesseract) platform gate.
 *
 * Formerly gated on onnxruntime for ppu-paddle-ocr; now tesseract via pdftoppm
 * is the only engine, supported wherever tesseract+pdftoppm+tessdata are present.
 */

export type OcrPlatformHints = {
  platform?: NodeJS.Platform
  arch?: string
}

/** True when this OS/arch is allowed to load OCR. tesseract is sole engine, supported everywhere. */
export function isOcrPlatformSupported(hints: OcrPlatformHints = {}): boolean {
  return true
}

/** Human reason when OCR must not load; undefined when supported. */
export function ocrUnsupportedReason(hints: OcrPlatformHints = {}): string | undefined {
  return undefined
}
