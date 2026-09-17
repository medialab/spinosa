import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
// Before pdfjs: install ImageData/Path2D/DOMMatrix from ESM @napi-rs/canvas
// (pdfjs createRequire fails on Linux Bun --compile; see pdfjs-canvas-globals.ts).
import "./pdfjs-canvas-globals"
import { getDocument, GlobalWorkerOptions, OPS, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs"
// Statically imported so Bun bundles the worker code INTO the single-file
// binary (a runtime dynamic import cannot resolve inside it — that was the
// "Cannot find module './pdf.worker.mjs'" failure that failed every PDF).
// pdfjs-dist ships no types for the worker module; the export exists at
// runtime (`export { WorkerMessageHandler }` in pdf.worker.mjs).
// @ts-ignore TS2307: no declaration file for the pdf.js worker module.
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs"
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
/** Resolved once: file URL of pdfjs standard-font data, if present on disk. */
let standardFontDataUrl: string | undefined
let standardFontProbed = false

/**
 * pdf.js parses on a background "worker" thread in browsers; in Node/Bun it
 * runs that same parser code on the main thread ("fake worker" — pdf.js's own
 * name for it, not ours). Its loader dynamic-imports workerSrc, which does not
 * exist inside the compiled single-file binary (every PDF failed with
 * "Cannot find module './pdf.worker.mjs'"), so publish the statically-bundled
 * handler via pdf.js's official main-thread hook: PDFWorker checks
 * globalThis.pdfjsWorker first and never touches the filesystem. Eager (module
 * scope) so it is always in place before the first getDocument call.
 */
export function isPdfJsMainThreadHandlerPublished(): boolean {
  const g = globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }
  return Boolean(g.pdfjsWorker?.WorkerMessageHandler)
}

{
  const g = globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }
  if (!g.pdfjsWorker?.WorkerMessageHandler) {
    g.pdfjsWorker = { ...(g.pdfjsWorker ?? {}), WorkerMessageHandler }
  }
}

function ensurePdfJsWorker(): void {
  if (workerConfigured) return
  workerConfigured = true
  if (isCompiledBinaryDistribution()) return
  try {
    const workerModule = "pdfjs-dist/legacy/build/pdf.worker.mjs"
    const workerPath = require.resolve(workerModule)
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    // Main-thread handler above already covers us.
  }
}

function resolveStandardFontDataUrl(): string | undefined {
  if (standardFontProbed) return standardFontDataUrl
  standardFontProbed = true
  if (isCompiledBinaryDistribution()) return standardFontDataUrl
  try {
    const workerModule = "pdfjs-dist/legacy/build/pdf.worker.mjs"
    const workerPath = require.resolve(workerModule)
    // standard_fonts/ sits two levels above legacy/build/ (join normalizes).
    const fontsDir = path.join(path.dirname(workerPath), "..", "..", "standard_fonts")
    standardFontDataUrl = pathToFileURL(fontsDir + path.sep).href
  } catch {
    standardFontDataUrl = undefined
  }
  return standardFontDataUrl
}

/**
 * Document-parse budget scales with file size. A fixed 2s budget starves big
 * digital PDFs (print-optimized, object streams, hi-res assets) into the
 * vision/OCR path even though every page carries embedded text.
 */
export function pdfDocLoadTimeoutMs(sizeBytes: number): number {
  const sizeMB = Math.max(0, sizeBytes / 1048576)
  return Math.min(30_000, 2_000 + Math.ceil(sizeMB * 250))
}

async function getDoc(pdfPath: string): Promise<PDFDocumentProxy> {
  ensurePdfJsWorker()
  const file = await readFile(pdfPath)
  const data = bufferToPdfJsUint8Array(file)
  // Standard-14 fonts (Helvetica et al.) need their metric data or glyph
  // mapping aborts mid-page and embedded text comes back truncated — which
  // downstream reads as "no text" and routes digital PDFs to vision.
  const fontDataUrl = resolveStandardFontDataUrl()
  const budget = pdfDocLoadTimeoutMs(file.byteLength)
  try {
    return await withTimeout(
      getDocument({
        data,
        CanvasFactory: NodeCanvasFactory,
        isEvalSupported: false,
        ...(fontDataUrl ? { standardFontDataUrl: fontDataUrl } : {}),
      }).promise,
      budget,
    )
  } catch (err) {
    // Deep context: without the file size, budget, font-data state and handler
    // mode, a "could not open" failure is undebuggable from logs alone.
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `pdf.js could not parse ${path.basename(pdfPath)} ` +
        `(${file.byteLength} bytes, ${budget}ms budget, ` +
        `mainThreadHandler=${isPdfJsMainThreadHandlerPublished() ? "ready" : "MISSING"}, ` +
        `standardFonts=${fontDataUrl ?? "unavailable"}): ${msg}`,
      { cause: err },
    )
  }
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

type Ctm = { a: number; b: number; c: number; d: number; e: number; f: number }
const IDENTITY_CTM: Ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/**
 * Fraction of the page area covered by painted raster images (0..1).
 * A folio number or caption on a full-page photo must not "prove" the page
 * digital — but a 219px profile photo on a text CV must not burn a vision
 * call either. Coverage separates the two. Image masks are excluded (they
 * back transparency effects, not content).
 * Fail-closed: operator-list errors return 1 (a wasted model call beats
 * lost evidence).
 */
export async function pdfDocumentPageImageCoverage(doc: PDFDocumentProxy, page: number): Promise<number> {
  try {
    const pg = await withTimeout(doc.getPage(page), PDF_PAGE_TIMEOUT_MS)
    const viewport = pg.getViewport({ scale: 1 })
    const pageArea = Math.max(1, viewport.width * viewport.height)
    const ops = await withTimeout(pg.getOperatorList(), PDF_PAGE_TIMEOUT_MS)
    const fns: unknown = (ops as { fnArray?: unknown }).fnArray
    const args: unknown = (ops as { argsArray?: unknown }).argsArray
    if (!Array.isArray(fns) || !Array.isArray(args)) return 1
    const stack: Ctm[] = [{ ...IDENTITY_CTM }]
    let covered = 0
    const current = (): Ctm => stack[stack.length - 1] ?? { ...IDENTITY_CTM }
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i]
      if (fn === OPS.save) {
        stack.push({ ...current() })
        continue
      }
      if (fn === OPS.restore) {
        if (stack.length > 1) stack.pop()
        continue
      }
      if (fn === OPS.transform) {
        const m = args[i] as number[] | undefined
        if (Array.isArray(m) && m.length >= 6) {
          const [a2, b2, c2, d2, e2, f2] = m as [number, number, number, number, number, number]
          const t = current()
          stack[stack.length - 1] = {
            a: t.a * a2 + t.b * c2,
            b: t.a * b2 + t.b * d2,
            c: t.c * a2 + t.d * c2,
            d: t.c * b2 + t.d * d2,
            e: t.e * a2 + t.f * c2 + e2,
            f: t.e * b2 + t.f * d2 + f2,
          }
        }
        continue
      }
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        // Unit-square image drawn through the CTM (rotation-safe approx).
        const t = current()
        const w = Math.hypot(t.a, t.b)
        const h = Math.hypot(t.c, t.d)
        covered += (w * h) / pageArea
      }
    }
    return Math.min(1, covered)
  } catch {
    return 1
  }
}

export async function pdfTextPagesMeetThreshold(pdfPath: string, pageCount: number): Promise<boolean> {
  return withPdfDocument(pdfPath, (doc) => pdfDocumentTextPagesMeetThreshold(doc, pageCount))
}

export async function pdfDocumentTextPagesMeetThreshold(doc: PDFDocumentProxy, pageCount = doc.numPages): Promise<boolean> {
  const pc = Math.max(1, Math.floor(pageCount))
  // Sampling first/middle/last pages misses sparse, genuinely digital PDFs.
  for (let page = 1; page <= pc; page++) {
    if (await pdfDocumentPageHasExtractableText(doc, page)) return true
  }
  return false
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
    // pdfjs-dist@5 RenderParameters requires `canvas`; context + viewport as before.
    await withTimeout(
      pg.render({
        canvas: canvas as unknown as HTMLCanvasElement,
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
  return withPdfDocument(pdfPath, pdfDocumentExtractAllText)
}

export const PDF_TEXT_EXTRACTION_FAILED_MARKER = "[Page text extraction failed]"

export async function pdfDocumentExtractAllText(doc: PDFDocumentProxy): Promise<string> {
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const pg = await withTimeout(doc.getPage(i), PDF_PAGE_TIMEOUT_MS)
      const content = await withTimeout(pg.getTextContent(), PDF_PAGE_TIMEOUT_MS)
      pages.push(stripAnsi(content.items.map((item) => ("str" in item ? item.str : "")).join(" ")))
    } catch {
      // Keep the gap explicit so callers never accept a partial transcript.
      pages.push(PDF_TEXT_EXTRACTION_FAILED_MARKER)
    }
  }
  return pages.join("\n\n")
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
        result.push({ page: i, text: PDF_TEXT_EXTRACTION_FAILED_MARKER })
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
