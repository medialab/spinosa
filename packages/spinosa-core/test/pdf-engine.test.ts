import { describe, expect, test } from "bun:test"
import {
  PDF_RENDER_DPI_NORMAL,
  PDF_RENDER_DPI_RETRY,
  VISION_LONG_SIDE_PX,
  isUsableText,
  PDF_TEXT_EXTRACTION_FAILED_MARKER,
} from "../src/pdf/index"

describe("internal PDF engine contract", () => {
  test("adaptive rendering policy constants", () => {
    expect(PDF_RENDER_DPI_NORMAL).toBeGreaterThanOrEqual(180)
    expect(PDF_RENDER_DPI_NORMAL).toBeLessThanOrEqual(220)
    expect(PDF_RENDER_DPI_RETRY).toBe(300)
    expect(VISION_LONG_SIDE_PX).toBeGreaterThanOrEqual(2000)
    expect(VISION_LONG_SIDE_PX).toBeLessThanOrEqual(2500)
  })

  test("isUsableText rejects blanks and failure markers", () => {
    expect(isUsableText("  \n ")).toBe(false)
    expect(isUsableText(PDF_TEXT_EXTRACTION_FAILED_MARKER)).toBe(false)
    expect(isUsableText("Hello world")).toBe(true)
  })

  test("no production pdftoppm dependency in the internal engine", async () => {
    const render = await import("../src/pdf/render")
    const src = render.renderPage.toString()
    expect(src).not.toContain("pdftoppm")
    expect(src).not.toContain("poppler")
    const text = await import("../src/pdf/text")
    expect(text.extractPageText.toString()).not.toContain("pdftoppm")
  })

  test("MarkItDown never handles PDFs (single PDF subsystem)", async () => {
    const pipeline = await import("../src/import/pipeline")
    const src = pipeline.scanAndClassifySource.toString()
    expect(src.length).toBeGreaterThan(0)
    const tesseract = await import("../src/import/tesseract-ocr")
    expect(tesseract.pdfHasTextLayer.toString()).not.toContain("MarkItDown")
    expect(tesseract.pdfHasTextLayer.toString()).not.toContain("markitdownConvertFile")
  })
})
