// Dedicated PDF step: pdf.js extracts text pages; image pages get tesseract
// only when explicitly selected, otherwise explicit placeholders (original
// kept for a later vision pass). No vision calls are ever made here.
import { describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { processPdf, type ClassifiedEntry } from "../src/import/pipeline"
import { runImportProcessor } from "../src/import/processors"
import { runImportWorkflow } from "../src/import/import-workflow"

const FIXTURES = path.join(import.meta.dir, "fixtures")
const DIGITAL = path.join(FIXTURES, "digital-3p.pdf")
const MIXED = path.join(FIXTURES, "mixed-3p.pdf")
const SCANNED = path.join(FIXTURES, "scanned-2p.pdf")
const VISION_ID = "openai/gpt-4o-mini"

function stage(name: string) {
  const root = mkdtempSync(path.join(tmpdir(), `spinosa-pdfphase-${name}-`))
  const logsDir = path.join(root, ".logs")
  mkdirSync(logsDir, { recursive: true })
  const raw = path.join(root, "raw")
  mkdirSync(raw, { recursive: true })
  return { root, logsDir, raw }
}

function pdfEntry(root: string, raw: string, fixture: string, rel: string): ClassifiedEntry {
  const src = path.join(root, rel)
  mkdirSync(path.dirname(src), { recursive: true })
  copyFileSync(fixture, src)
  return { src, rel, dest: path.join(raw, `${path.basename(rel, ".pdf")}__pdf.md`) }
}

describe("processPdf", () => {
  test("pdf.js main-thread handler is published (single-file binary has no worker file)", async () => {
    // Regression: every PDF failed in the compiled binary with
    // "Cannot find module './pdf.worker.mjs'". pdf.js's official main-thread
    // hook must be populated at import time so its loader never hits the disk.
    const { isPdfJsMainThreadHandlerPublished } = await import("../src/extension/pdf-js")
    expect(isPdfJsMainThreadHandlerPublished()).toBe(true)
  })

  test("logs mode line and per-page census for diagnosis", async () => {
    const { root, raw, logsDir } = stage("diag")
    try {
      const files = [pdfEntry(root, raw, DIGITAL, "diag.pdf")]
      const logs: string[] = []
      const res = await processPdf(files, logsDir, undefined, (m) => logs.push(m), undefined)
      expect(res.failed).toBe(0)
      expect(logs.some((l) => l.startsWith("PDF step: pdf.js-only text extraction"))).toBe(true)
      const census = logs.find((l) => l.includes("pdf.js parsed 3 pages in "))
      expect(census).toBeDefined()
      expect(census).toContain("3 with text")
      expect(census).toContain("source ")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  test("non-PDF entries fail honestly instead of converting", async () => {
    const { root, logsDir, raw } = stage("reject")
    try {
      const txt = path.join(root, "note.txt")
      await Bun.write(txt, "hello")
      const files: ClassifiedEntry[] = [{ src: txt, rel: "note.txt", dest: path.join(raw, "note.txt") }]
      const logs: string[] = []
      const res = await processPdf(files, logsDir, undefined, (m) => logs.push(m))
      expect(res.converted).toBe(0)
      expect(res.failed).toBe(1)
      expect(logs.some((l) => l.includes("not a PDF"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("vision selection: text extracts via pdf.js, zero model calls", async () => {
    const { root, logsDir, raw } = stage("vision")
    try {
      const files = [pdfEntry(root, raw, MIXED, "mixed.pdf")]
      const logs: string[] = []
      const res = await processPdf(files, logsDir, undefined, (m) => logs.push(m), undefined, {
        ocrModelId: VISION_ID,
      })
      expect(res.converted).toBe(1)
      expect(res.failed).toBe(0)
      // No transcribe hook exists on this path by design — nothing can call out.
      // Multi-page output is an index + splits; text lives in the splits.
      const md = readFileSync(path.join(raw, "mixed__pdf", "page-001.md"), "utf-8")
      expect(md).toContain("embedded digital text")
      expect(logs.some((l) => l.includes("placeholders kept") || l.includes("direct via pdf.js"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("tesseract selection: image pages fill via tesseract, text stays direct", async () => {
    const { tesseractAvailable } = await import("../src/import/tesseract-ocr")
    if (!tesseractAvailable()) return
    const { root, logsDir, raw } = stage("tess")
    try {
      const files = [pdfEntry(root, raw, MIXED, "mixed.pdf")]
      const logs: string[] = []
      const res = await processPdf(files, logsDir, undefined, (m) => logs.push(m), undefined, {
        ocrModelId: "tesseract-local",
      })
      expect(res.converted).toBe(1)
      expect(res.failed).toBe(0)
      const md = readFileSync(path.join(raw, "mixed__pdf", "page-001.md"), "utf-8")
      expect(md).toContain("embedded digital text")
      expect(logs.some((l) => l.includes("via tesseract"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)

  test("pure scan: original kept, placeholder written, skipped for later retry", async () => {
    const { root, logsDir, raw } = stage("scan")
    try {
      const files = [pdfEntry(root, raw, SCANNED, "scan.pdf")]
      const logs: string[] = []
      const res = await processPdf(files, logsDir, undefined, (m) => logs.push(m), undefined, {
        ocrModelId: VISION_ID,
      })
      expect(res.converted).toBe(0)
      expect(res.failed).toBe(0)
      expect(res.skipped).toBe(1)
      expect(existsSync(files[0]!.dest)).toBe(true)
      expect(existsSync(path.join(raw, "scan.pdf"))).toBe(true)
      expect(readFileSync(files[0]!.dest, "utf-8")).toContain("pending vision OCR")
      expect(logs.some((l) => l.includes("no extractable text"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("no engine (keep-as-is): PDFs fail honestly, never extracted", async () => {
    const { root, logsDir, raw } = stage("none")
    try {
      const files = [pdfEntry(root, raw, DIGITAL, "digital.pdf")]
      const logs: string[] = []
      const res = await processPdf(files, logsDir, undefined, (m) => logs.push(m), undefined, {
        ocrModelId: "none",
      })
      expect(res.converted).toBe(0)
      expect(res.failed).toBe(1)
      expect(existsSync(files[0]!.dest)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("unreadable PDF fails honestly with zero model calls", async () => {
    const { root, logsDir, raw } = stage("corrupt")
    try {
      const src = path.join(root, "broken.pdf")
      await Bun.write(src, "this is not a pdf, just garbage bytes %PDF-then-nothing")
      const files: ClassifiedEntry[] = [{ src, rel: "broken.pdf", dest: path.join(raw, "broken__pdf.md") }]
      const logs: string[] = []
      const res = await processPdf(files, logsDir, undefined, (m) => logs.push(m), undefined, {
        ocrModelId: VISION_ID,
      })
      expect(res.converted).toBe(0)
      expect(res.failed).toBe(1)
      expect(existsSync(files[0]!.dest)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("runImportProcessor pdf", () => {
  test("registry routes pdf id with engine options", async () => {
    const { root, logsDir, raw } = stage("registry")
    try {
      const files = [pdfEntry(root, raw, DIGITAL, "digital.pdf")]
      const res = await runImportProcessor("pdf", { files, logsDir, ocrModelId: VISION_ID })
      expect(res.converted).toBe(1)
      expect(res.failed).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("runImportWorkflow pdf step split", () => {
  test("PDFs leave vision/ocr buckets for the pdf step; images stay in vision", async () => {
    const { root, logsDir, raw } = stage("split")
    try {
      const img = path.join(root, "img.png")
      await Bun.write(img, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      const classified = {
        directFiles: [] as ClassifiedEntry[],
        markitdownFiles: [] as ClassifiedEntry[],
        visionFiles: [
          pdfEntry(root, raw, MIXED, "mixed.pdf"),
          { src: img, rel: "img.png", dest: path.join(raw, "img__png.md") },
        ] as ClassifiedEntry[],
        ocrFiles: [] as ClassifiedEntry[],
        logsDir,
      }
      const seenPhases: string[] = []
      const transcribed: string[] = []
      const results = await runImportWorkflow(classified, {
        ocrModelId: VISION_ID,
        transcribeVision: async (req) => {
          transcribed.push(req.image.mime)
          return "page transcript"
        },
        beforePhase: async (id, files) => {
          if (files === 0) return false
          seenPhases.push(`${id}:${files}`)
          return true
        },
      })
      // PDF ran in its own step (no model involved); vision kept only the image.
      expect(seenPhases).toContain("pdf:1")
      expect(seenPhases).toContain("vision:1")
      expect(results.pdf.converted).toBe(1)
      expect(results.vision.converted).toBe(1)
      expect(transcribed).toEqual(["image/png"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
