// Vision must only ever see imageless pages. Classification is structural
// (operator-list image detection), never a char-count threshold: a folio
// number must not "prove" a photo page digital.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { isTextBasedPdf } from "../src/extension/pdf"
import {
  PDF_TEXT_EXTRACTION_FAILED_MARKER,
  pdfDocLoadTimeoutMs,
  pdfDocumentExtractAllText,
  pdfDocumentTextPagesMeetThreshold,
} from "../src/extension/pdf-js"
import { pdfCensusTimeoutMs } from "../src/extension/pdf"
import {
  classifyPdfPages,
  classifyPdfPage,
  contiguousRanges,
  hasEmbeddedTextPdfPages,
  isDigitalPdfPages,
  partitionPdfPages,
} from "../src/import/pdf-pages"

// Real fixtures (see test/fixtures/README.md): digital-3p (embedded text),
// scanned-2p (font-free blanks), photo-1p (raster photo, zero text),
// mixed-3p (text + photo + text).
const DIGITAL_FIXTURE = path.join(import.meta.dir, "fixtures", "digital-3p.pdf")
const SCANNED_FIXTURE = path.join(import.meta.dir, "fixtures", "scanned-2p.pdf")
const PHOTO_FIXTURE = path.join(import.meta.dir, "fixtures", "photo-1p.pdf")
const MIXED_FIXTURE = path.join(import.meta.dir, "fixtures", "mixed-3p.pdf")

describe("census timeouts scale with file size", () => {
  test("doc-load budget grows then caps", () => {
    expect(pdfDocLoadTimeoutMs(0)).toBe(2000)
    expect(pdfDocLoadTimeoutMs(100 * 1048576)).toBe(27000)
    expect(pdfDocLoadTimeoutMs(10 * 1024 * 1048576)).toBe(30000)
  })

  test("census budget grows then caps", () => {
    expect(pdfCensusTimeoutMs(0)).toBe(5000)
    expect(pdfCensusTimeoutMs(10 * 1048576)).toBe(15000)
    expect(pdfCensusTimeoutMs(10 * 1024 * 1048576)).toBe(60000)
  })
})

describe("text census", () => {
  test("finds a sparse digital page outside the old first/middle/last sample", async () => {
    const doc = {
      numPages: 5,
      getPage: async (page: number) => ({
        getTextContent: async () => ({ items: page === 2 ? [{ str: "embedded text" }] : [] }),
      }),
    }
    expect(await pdfDocumentTextPagesMeetThreshold(doc as never)).toBe(true)
  })

  test("keeps failed pages explicit instead of silently dropping them", async () => {
    const doc = {
      numPages: 2,
      getPage: async (page: number) => {
        if (page === 2) throw new Error("bad page")
        return { getTextContent: async () => ({ items: [{ str: "first page" }] }) }
      },
    }
    expect(await pdfDocumentExtractAllText(doc as never)).toBe(`first page\n\n${PDF_TEXT_EXTRACTION_FAILED_MARKER}`)
  })
})

describe("partitionPdfPages", () => {
  test("large raster coverage routes to vision even with text on the page", () => {
    const [photo] = partitionPdfPages([{ page: 1, text: "Figure 3: results overview", imageCoverage: 0.6 }])
    expect(photo?.kind).toBe("image")
  })

  test("small photos stay direct; blanks stay direct", () => {
    const [cv] = partitionPdfPages([{ page: 1, text: "Jane Doe, researcher", imageCoverage: 0.054 }])
    const [figure] = partitionPdfPages([{ page: 2, text: "Figure 3: results", imageCoverage: 0.35 }])
    const [blank] = partitionPdfPages([{ page: 3, text: "   \n", imageCoverage: 0 }])
    expect(cv?.kind).toBe("text")
    expect(figure?.kind).toBe("text")
    expect(blank?.kind).toBe("text")
  })

  test("coverage boundary honors IMAGE_COVERAGE_MIN", () => {
    const [at] = partitionPdfPages([{ page: 1, text: "", imageCoverage: 0.4 }])
    const [below] = partitionPdfPages([{ page: 1, text: "", imageCoverage: 0.399 }])
    expect(at?.kind).toBe("image")
    expect(below?.kind).toBe("text")
  })

  test("direct extraction requires text and no unknown/image pages", () => {
    const digital = partitionPdfPages([{ page: 1, text: "embedded", imageCoverage: 0 }])
    const mixed = partitionPdfPages([
      { page: 1, text: "embedded", imageCoverage: 0 },
      { page: 2, text: "caption", imageCoverage: 0.8 },
    ])
    expect(isDigitalPdfPages(digital)).toBe(true)
    expect(isDigitalPdfPages(mixed)).toBe(false)
    expect(hasEmbeddedTextPdfPages(mixed)).toBe(true)
    expect(isDigitalPdfPages(partitionPdfPages([{ page: 1, text: "", imageCoverage: 0 }]))).toBe(false)
  })

  test("a page whose text extraction fails routes to OCR", () => {
    expect(classifyPdfPage(1, "", 0, true)).toEqual({ page: 1, kind: "image" })
  })

  test("a failed coverage probe fails only that page closed, not the census", () => {
    // Coverage errors must never void every other page's result: the failed
    // page routes to OCR as image even when it carries text.
    expect(classifyPdfPage(2, "real text here", 0.1, true)).toEqual({ page: 2, kind: "image" })
    expect(classifyPdfPage(2, "real text here", 0.1, false)).toEqual({ page: 2, kind: "text", text: "real text here" })
  })
})

describe("classifyPdfPages end to end", () => {
  test("digital file: all text", async () => {
    const classes = await classifyPdfPages(DIGITAL_FIXTURE)
    expect(classes.length).toBe(3)
    expect(classes.every((c) => c.kind === "text")).toBe(true)
  })

  test("photo file: image despite font resources in the container", async () => {
    const classes = await classifyPdfPages(PHOTO_FIXTURE)
    expect(classes.length).toBe(1)
    expect(classes[0]?.kind).toBe("image")
  })

  test("blank pages: direct placeholder, zero vision cost", async () => {
    const classes = await classifyPdfPages(SCANNED_FIXTURE)
    expect(classes.length).toBe(2)
    // No text AND no raster: nothing vision could add. Vector-only artwork
    // pages behave the same — their figures are out of scope for text
    // extraction by design (vision is for scans/photos only).
    expect(classes.every((c) => c.kind === "text")).toBe(true)
  })

  test("mixed file: text, image, text in order", async () => {
    const classes = await classifyPdfPages(MIXED_FIXTURE)
    expect(classes.map((c) => c.kind)).toEqual(["text", "image", "text"])
  })
})

describe("isTextBasedPdf", () => {
  test("digital passes, blank-scan fails closed toward OCR", async () => {
    expect(await isTextBasedPdf(DIGITAL_FIXTURE)).toBe(true)
    expect(await isTextBasedPdf(SCANNED_FIXTURE)).toBe(false)
  })

  test("non-PDF and missing files fail closed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "spinosa-pdf-routing-"))
    const txt = path.join(dir, "note.txt")
    await Bun.write(txt, "hello")
    expect(await isTextBasedPdf(txt)).toBe(false)
    expect(await isTextBasedPdf(path.join(dir, "missing.pdf"))).toBe(false)
  })
})

describe("tesseract hybrid on a mixed document", () => {
  test("direct text pages kept, photo page OCR'd, order preserved", async () => {
    const { tesseractAvailable } = await import("../src/import/tesseract-ocr")
    if (!tesseractAvailable()) return
    const { convertPdfHybridTesseract } = await import("../src/import/tesseract-ocr")
    const dir = mkdtempSync(path.join(tmpdir(), "spinosa-pdf-hybrid-"))
    const dest = path.join(dir, "mixed__pdf.md")
    const classes = await classifyPdfPages(MIXED_FIXTURE)
    expect(classes.map((c) => c.kind)).toEqual(["text", "image", "text"])
    const result = await convertPdfHybridTesseract(MIXED_FIXTURE, dest, "mixed.pdf", classes)
    expect(result).toMatchObject({ pages: 3, ocrPages: 1 })
    const md = await Bun.file(dest).text()
    expect(md).toContain("## Page 1")
    expect(md).toContain("## Page 2")
    expect(md).toContain("## Page 3")
    expect(md).toContain("embedded digital text")
    const split = await Bun.file(path.join(dir, "mixed__pdf", "page-002.md")).text()
    expect(split).toContain("page: 2")
  }, 120_000)
})

describe("contiguousRanges", () => {
  test("groups sorted runs for pdftoppm -f/-l", () => {
    expect(contiguousRanges([1, 2, 3, 5, 7, 8, 9])).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
      { from: 7, to: 9 },
    ])
    expect(contiguousRanges([3, 1, 2, 2])).toEqual([{ from: 1, to: 3 }])
    expect(contiguousRanges([])).toEqual([])
  })
})
