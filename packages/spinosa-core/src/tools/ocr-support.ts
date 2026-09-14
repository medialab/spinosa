/**
 * Product OCR (bundled Tesseract) platform gate.
 *
 * OCR is supported everywhere the Spinosa-owned Tesseract + tessdata assets
 * are installed under SPINOSA_HOME.
 */

export type OcrPlatformHints = {
  platform?: NodeJS.Platform
  arch?: string
}

/** True when this OS/arch is allowed to load OCR. Bundled Tesseract is supported everywhere. */
export function isOcrPlatformSupported(hints: OcrPlatformHints = {}): boolean {
  return true
}

/** Human reason when OCR must not load; undefined when supported. */
export function ocrUnsupportedReason(hints: OcrPlatformHints = {}): string | undefined {
  return undefined
}
