import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
// Before pdfjs: install ImageData/Path2D/DOMMatrix from ESM @napi-rs/canvas
// (pdfjs createRequire fails on Linux Bun --compile; see pdfjs-canvas-globals.ts).
import "./pdfjs-canvas-globals"
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs"
import { createCanvas, type Canvas } from "@napi-rs/canvas"
import stripAnsi from "strip-ansi"
import {
  canvasDebugLog,
  debugCanvasEnvironment,
  isCanvasDebugEnabled,
} from "./canvas-debug"
import { isCompiledBinaryDistribution } from "../distribution/bootstrap"

const require = createRequire(import.meta.url)

/**
 * Per-page budget for pdfjs getPage/getTextContent. One malformed/poisoned page
 * must not stall whole-document extraction or classification forever.
 */
export const PDF_PAGE_TIMEOUT_MS = 15_000

type NodeCanvasAndContext = {
  canvas: Canvas | null
  context: ReturnType<Canvas["getContext"]> | null
}

/**
 * pdfjs-dist rejects `instanceof Buffer` even though Buffer extends Uint8Array.
 * Bun `--compile` + minify can elide `new Uint8Array(buffer)` as an identity cast;
 * allocate + set so the binary still passes a plain Uint8Array.
 */
export function bufferToPdfJsUint8Array(data: Buffer): Uint8Array {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

/**
 * Force pdfjs to use our `@napi-rs/canvas@1.0.2` native binding.
 * Without this, pdfjs resolves a nested older canvas (e.g. 0.1.80) from its
 * own package tree; loading two Skia natives in one process segfaults under
 * Bun (and can under Node).
 */
class NodeCanvasFactory {
  create(width: number, height: number): NodeCanvasAndContext {
    const w = Math.max(1, Math.ceil(width))
    const h = Math.max(1, Math.ceil(height))
    try {
      const canvas = createCanvas(w, h)
      const context = canvas.getContext("2d")
      canvasDebugLog("NodeCanvasFactory.create", {
        ok: true,
        width: w,
        height: h,
        hasContext: Boolean(context),
        ImageData: typeof (globalThis as { ImageData?: unknown }).ImageData,
        Path2D: typeof (globalThis as { Path2D?: unknown }).Path2D,
      })
      return { canvas, context }
    } catch (e) {
      canvasDebugLog("NodeCanvasFactory.create", {
        ok: false,
        width: w,
        height: h,
        error: e instanceof Error ? e.message : String(e),
        ImageData: typeof (globalThis as { ImageData?: unknown }).ImageData,
        Path2D: typeof (globalThis as { Path2D?: unknown }).Path2D,
      })
      throw e
    }
  }

  reset(canvasAndContext: NodeCanvasAndContext, width: number, height: number): void {
    if (!canvasAndContext.canvas) return
    canvasAndContext.canvas.width = Math.max(1, Math.ceil(width))
    canvasAndContext.canvas.height = Math.max(1, Math.ceil(height))
  }

  destroy(canvasAndContext: NodeCanvasAndContext): void {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = 0
      canvasAndContext.canvas.height = 0
    }
    canvasAndContext.canvas = null
    canvasAndContext.context = null
  }
}

let workerConfigured = false
function ensurePdfJsWorker(): void {
  if (workerConfigured) return
  // The worker is bundled in product binaries but is not an on-disk module.
  // Avoid resolving a build-machine path; pdf.js will use its fake worker.
  if (isCompiledBinaryDistribution()) {
    workerConfigured = true
    return
  }
  try {
    const workerModule = "pdfjs-dist/legacy/build/pdf.worker.mjs"
    const workerPath = require.resolve(workerModule)
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    // Compiled binary may lack an on-disk worker; pdfjs falls back to fake worker.
  }
  workerConfigured = true
}

async function getDoc(pdfPath: string): Promise<PDFDocumentProxy> {
  ensurePdfJsWorker()
  const file = await readFile(pdfPath)
  const data = bufferToPdfJsUint8Array(file)
  return withTimeout(
    getDocument({
      data,
      CanvasFactory: NodeCanvasFactory,
      isEvalSupported: false,
    }).promise,
    2000,
  )
}

export async function withPdfDocument<T>(pdfPath: string, fn: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const doc = await getDoc(pdfPath)
  try {
    return await fn(doc)
  } finally {
    await doc.destroy().catch(() => {})
  }
}

export async function pdfPageCount(pdfPath: string): Promise<number> {
  return withPdfDocument(pdfPath, (doc) => Promise.resolve(doc.numPages))
}

export async function pdfTextContent(pdfPath: string, page: number): Promise<string> {
  return withPdfDocument(pdfPath, (doc) => pdfDocumentTextContent(doc, page))
}

export async function pdfDocumentTextContent(doc: PDFDocumentProxy, page: number): Promise<string> {
  const pg = await withTimeout(doc.getPage(page), PDF_PAGE_TIMEOUT_MS)
  const content = await withTimeout(pg.getTextContent(), PDF_PAGE_TIMEOUT_MS)
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ")
}
export async function pdfPageHasExtractableText(pdfPath: string, page: number): Promise<boolean> {
  return withPdfDocument(pdfPath, (doc) => pdfDocumentPageHasExtractableText(doc, page))
}

export async function pdfDocumentPageHasExtractableText(doc: PDFDocumentProxy, page: number): Promise<boolean> {
  const text = await pdfDocumentTextContent(doc, page)
  return text.replace(/\s/g, "").length > 0
}

export async function pdfTextPagesMeetThreshold(pdfPath: string, pageCount: number): Promise<boolean> {
  return withPdfDocument(pdfPath, (doc) => pdfDocumentTextPagesMeetThreshold(doc, pageCount))
}

export async function pdfDocumentTextPagesMeetThreshold(doc: PDFDocumentProxy, pageCount = doc.numPages): Promise<boolean> {
  const pc = Math.max(1, Math.floor(pageCount))

  if (pc === 1) return pdfDocumentPageHasExtractableText(doc, 1)
  if (pc === 2) {
    const [a, b] = await Promise.all([
      pdfDocumentPageHasExtractableText(doc, 1),
      pdfDocumentPageHasExtractableText(doc, 2),
    ])
    return a && b
  }

  const mid = Math.floor((pc + 1) / 2)
  const last = pc
  const results = await Promise.all([
    pdfDocumentPageHasExtractableText(doc, 1),
    pdfDocumentPageHasExtractableText(doc, mid),
    pdfDocumentPageHasExtractableText(doc, last),
  ])
  const hits = results.filter(Boolean).length
  return hits >= 2
}
export async function pdfRenderPageToPng(pdfPath: string, pageNumber: number, dpi = 180): Promise<Buffer> {
  return withPdfDocument(pdfPath, (doc) => pdfRenderDocumentPageToPng(doc, pageNumber, dpi))
}

export async function pdfRenderDocumentPageToPng(doc: PDFDocumentProxy, pageNumber: number, dpi = 180): Promise<Buffer> {
  if (isCanvasDebugEnabled()) {
    await debugCanvasEnvironment(`pdfRenderDocumentPageToPng:page=${pageNumber}`)
  }
  const pg = await doc.getPage(pageNumber)
  const viewport = pg.getViewport({ scale: dpi / 72 })
  canvasDebugLog("pdfRenderDocumentPageToPng.before-create", {
    pageNumber,
    dpi,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    ImageData: typeof (globalThis as { ImageData?: unknown }).ImageData,
    Path2D: typeof (globalThis as { Path2D?: unknown }).Path2D,
    DOMMatrix: typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix,
  })
  const factory = new NodeCanvasFactory()
  const canvasAndContext = factory.create(viewport.width, viewport.height)
  const { canvas, context } = canvasAndContext
  if (!canvas || !context) throw new Error("pdfjs NodeCanvasFactory failed to create canvas")
  try {
    // pdfjs-dist@4 RenderParameters has no `canvas` field; context + viewport is enough.
    await withTimeout(
      pg.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise,
      PDF_PAGE_TIMEOUT_MS,
    )
    const png = canvas.toBuffer("image/png")
    canvasDebugLog("pdfRenderDocumentPageToPng.ok", { pageNumber, pngBytes: png.byteLength })
    return png
  } catch (e) {
    canvasDebugLog("pdfRenderDocumentPageToPng.fail", {
      pageNumber,
      error: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
      ImageData: typeof (globalThis as { ImageData?: unknown }).ImageData,
      Path2D: typeof (globalThis as { Path2D?: unknown }).Path2D,
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 8) : undefined,
    })
    throw e
  } finally {
    factory.destroy(canvasAndContext)
  }
}

export async function isTextBasedPdf(pdfPath: string): Promise<boolean> {
  const header = await readFile(pdfPath)
  if (header.subarray(0, 5).toString() !== "%PDF-") return false

  if (searchBuffer(header, Buffer.from("/Encrypt"), 0, header.length)) return false

  const quickLen = Math.min(header.length, 262144)
  if (
    searchBuffer(header, Buffer.from("/Font"), 0, quickLen) ||
    searchBuffer(header, Buffer.from("/CIDFont"), 0, quickLen)
  ) return true

  if (
    searchBuffer(header, Buffer.from("/Font"), 0, header.length) ||
    searchBuffer(header, Buffer.from("/CIDFont"), 0, header.length)
  ) return true

  return withPdfDocument(pdfPath, (doc) => pdfDocumentTextPagesMeetThreshold(doc)).catch(() => false)
}

export async function pdfExtractAllText(pdfPath: string): Promise<string> {
  return withPdfDocument(pdfPath, async (doc) => {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const pg = await withTimeout(doc.getPage(i), PDF_PAGE_TIMEOUT_MS)
        const content = await withTimeout(pg.getTextContent(), PDF_PAGE_TIMEOUT_MS)
        pages.push(stripAnsi(content.items.map((item) => ("str" in item ? item.str : "")).join(" ")))
      } catch {
        continue
      }
    }
    return pages.join("\n\n")
  })
}

export async function pdfExtractPageTexts(pdfPath: string): Promise<{ page: number; text: string }[]> {
  return withPdfDocument(pdfPath, async (doc) => {
    const result: { page: number; text: string }[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const pg = await withTimeout(doc.getPage(i), PDF_PAGE_TIMEOUT_MS)
        const content = await withTimeout(pg.getTextContent(), PDF_PAGE_TIMEOUT_MS)
        result.push({
          page: i,
          text: stripAnsi(content.items.map((item) => ("str" in item ? item.str : "")).join(" ")),
        })
      } catch {
        // Never silently drop a page: a failed page is an explicit gap in
        // the transcript so downstream never mistakes it for blank.
        result.push({ page: i, text: "[Page text extraction failed]" })
      }
    }
    return result
  })
}

function searchBuffer(haystack: Buffer, needle: Buffer, start: number, end: number): boolean {
  return haystack.subarray(start, end).indexOf(needle) !== -1
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}
