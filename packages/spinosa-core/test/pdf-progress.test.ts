// Per-page progress for PDF import paths: tesseract/digital splits tick
// onPage per page (TUI renders PG: N/M), and over-long destinations resolve
// to the path actually written instead of reporting "no output".
import { describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { convertTextPdf } from "../src/import/pipeline"

const FIXTURES = path.join(import.meta.dir, "fixtures")
const DIGITAL = path.join(FIXTURES, "digital-3p.pdf")
const SCANNED = path.join(FIXTURES, "scanned-2p.pdf")

function stage(name: string) {
  const root = mkdtempSync(path.join(tmpdir(), `spinosa-pdfprog-${name}-`))
  const logsDir = path.join(root, ".logs")
  mkdirSync(logsDir, { recursive: true })
  const raw = path.join(root, "raw")
  mkdirSync(raw, { recursive: true })
  return { root, logsDir, raw }
}

describe("convertTextPdf onPage ticks", () => {
  test("ticks once per page with totals", async () => {
    const { root, raw } = stage("ticks")
    try {
      const src = path.join(root, "digital.pdf")
      copyFileSync(DIGITAL, src)
      const dest = path.join(raw, "digital__pdf.md")
      const ticks: Array<[number, number]> = []
      const actual = await convertTextPdf(src, dest, "digital.pdf", undefined, (p, t) => void ticks.push([p, t]))
      expect(ticks).toEqual([[1, 3], [2, 3], [3, 3]])
      expect(actual).toBe(dest)
      expect(readFileSync(dest, "utf-8")).toContain("Page 1")
    } finally {
      const { rmSync } = await import("node:fs")
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("over-long destination resolves to the truncated path, not 'no output'", async () => {
    const { root, raw } = stage("longname")
    try {
      const src = path.join(root, "digital.pdf")
      copyFileSync(DIGITAL, src)
      // 240-char stem: requested dest overflows the per-component limit.
      const longStem = `${"n".repeat(240)}__pdf.md`
      const dest = path.join(raw, longStem)
      const ticks: Array<[number, number]> = []
      const actual = await convertTextPdf(src, dest, `${"n".repeat(240)}.pdf`, undefined, (p, t) => void ticks.push([p, t]))
      expect(ticks.length).toBe(3)
      expect(existsSync(actual)).toBe(true)
      expect(Buffer.byteLength(path.basename(actual), "utf8")).toBeLessThanOrEqual(255)
      expect(readFileSync(actual, "utf-8")).toContain("Page 1")
    } finally {
      const { rmSync } = await import("node:fs")
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("ocrPdfViaTesseract onPage ticks", () => {
  test("ticks per rendered page with totals", async () => {
    const { tesseractAvailable } = await import("../src/import/tesseract-ocr")
    if (!tesseractAvailable()) return
    const { ocrPdfViaTesseract } = await import("../src/import/tesseract-ocr")
    const { root, raw } = stage("tessticks")
    try {
      const src = path.join(root, "scan.pdf")
      copyFileSync(SCANNED, src)
      const ticks: Array<[number, number]> = []
      const logs: string[] = []
      const res = await ocrPdfViaTesseract(src, path.join(raw, "scan__pdf.md"), "scan.pdf", {
        onLog: (m) => logs.push(m),
        onPage: (p, t) => void ticks.push([p, t]),
      })
      expect(res.pages).toBe(2)
      expect(ticks).toEqual([[1, 2], [2, 2]])
      expect(logs.some((l) => l.includes("splitting into 2 pages") && l.includes("tesseract"))).toBe(true)
    } finally {
      const { rmSync } = await import("node:fs")
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
