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

/** True when this OS/arch is allowed to load OCR/onnx natives. */
export function isOcrPlatformSupported(hints: OcrPlatformHints = {}): boolean {
  const platform = hints.platform ?? process.platform
  const arch = hints.arch ?? process.arch
  if (platform === "linux" && arch === "x64") return false
  return true
}

/** Human reason when OCR must not load; undefined when supported. */
export function ocrUnsupportedReason(hints: OcrPlatformHints = {}): string | undefined {
  // Tesseract has no onnx native gate; availability is probed via tesseractAvailable()
  // Keep platform gate for documentation, but always supported where tesseract is installed.
  if (isOcrPlatformSupported(hints)) return undefined
  const platform = hints.platform ?? process.platform
  const arch = hints.arch ?? process.arch
  return `OCR is unsupported on ${platform}-${arch} in this build`
}
