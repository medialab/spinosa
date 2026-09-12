import { readFile } from "node:fs/promises"

const QUICK_SCAN_LEN = 262144
const CENSUS_BASE_TIMEOUT_MS = 5000

/**
 * Census budget scales with file size for the same reason as the doc-load
 * budget: slow-to-parse must never read as has-no-text. A big digital PDF
 * that blows a fixed 5s budget lands in vision/OCR — slow, expensive, and
 * lower fidelity than its own embedded text.
 */
export function pdfCensusTimeoutMs(sizeBytes: number): number {
  const sizeMB = Math.max(0, sizeBytes / 1048576)
  return Math.min(60_000, CENSUS_BASE_TIMEOUT_MS + Math.ceil(sizeMB * 1000))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

async function pdfJs() {
  return import("./pdf-js")
}

export async function pdfExtractAllText(pdfPath: string): Promise<string> {
  const m = await pdfJs()
  return m.pdfExtractAllText(pdfPath)
}

export async function pdfExtractPageTexts(pdfPath: string): Promise<{ page: number; text: string }[]> {
  const m = await pdfJs()
  return m.pdfExtractPageTexts(pdfPath)
}

export async function pdfRenderPageToPng(pdfPath: string, pageNumber: number, dpi?: number): Promise<Buffer> {
  const m = await pdfJs()
  return m.pdfRenderPageToPng(pdfPath, pageNumber, dpi)
}

export async function pdfPageCount(pdfPath: string): Promise<number> {
  try {
    const m = await pdfJs()
    return await m.pdfPageCount(pdfPath)
  } catch {
    return 1
  }
}

export async function pdfPageHasExtractableText(
  pdfPath: string,
  page: number,
): Promise<boolean> {
  try {
    const m = await pdfJs()
    return await m.pdfPageHasExtractableText(pdfPath, page)
  } catch {
    return false
  }
}

export async function pdfTextPagesMeetThreshold(
  pdfPath: string,
  pageCount: number,
): Promise<boolean> {
  try {
    const m = await pdfJs()
    return await m.pdfTextPagesMeetThreshold(pdfPath, pageCount)
  } catch {
    return false
  }
}

export async function isTextBasedPdf(pdfPath: string): Promise<boolean> {
  if (fileExt(pdfPath) !== "pdf") return false

  let data: Buffer
  try {
    data = await readFile(pdfPath)
  } catch {
    return false
  }

  if (searchBuffer(data, Buffer.from("/Encrypt"), 0, data.length)) return false

  if (
    searchBuffer(data, Buffer.from("/Font"), 0, QUICK_SCAN_LEN) ||
    searchBuffer(data, Buffer.from("/CIDFont"), 0, QUICK_SCAN_LEN)
  ) return true

  if (
    searchBuffer(data, Buffer.from("/Font"), QUICK_SCAN_LEN, data.length) ||
    searchBuffer(data, Buffer.from("/CIDFont"), QUICK_SCAN_LEN, data.length)
  ) return true

  try {
    const m = await pdfJs()
    return await withTimeout(
      m.withPdfDocument(pdfPath, (doc) => m.pdfDocumentTextPagesMeetThreshold(doc)),
      pdfCensusTimeoutMs(data.byteLength),
    )
  } catch {
    return false
  }
}

function fileExt(filePath: string): string {
  const i = filePath.lastIndexOf(".")
  return i >= 0 ? filePath.slice(i + 1) : ""
}

function searchBuffer(haystack: Buffer, needle: Buffer, start: number, end: number): boolean {
  return haystack.subarray(start, end).indexOf(needle) !== -1
}
