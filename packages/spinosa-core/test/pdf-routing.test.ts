// PDF routing: MarkItDown takes office docs only — PDFs route by engine at
// scan time (vision / tesseract / copy-as-is) and split per page inside the
// owning phase (pdf.js text pages direct, image pages via engine).
import { describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { scanAndClassifySource, type ClassifiedEntry } from "../src/import/pipeline"
import { runImportWorkflow } from "../src/import/import-workflow"

const FIXTURES = path.join(import.meta.dir, "fixtures")
const DIGITAL = path.join(FIXTURES, "digital-3p.pdf")
const SCANNED = path.join(FIXTURES, "scanned-2p.pdf")
const VISION_ID = "openai/gpt-4o-mini"

function stageSource(name: string, files: Array<{ rel: string; fixture: string }>): { root: string; source: string; raw: string } {
  const root = mkdtempSync(path.join(tmpdir(), `spinosa-pdfroute-${name}-`))
  const source = path.join(root, "source")
  const raw = path.join(root, "raw")
  mkdirSync(source, { recursive: true })
  for (const f of files) {
    const dest = path.join(source, f.rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    copyFileSync(f.fixture, dest)
  }
  return { root, source, raw }
}

describe("scan buckets never send PDFs to MarkItDown", () => {
  test("vision selection: digital + scanned PDFs → visionFiles", async () => {
    const { root, source, raw } = stageSource("vision", [
      { rel: "digital.pdf", fixture: DIGITAL },
      { rel: "scan.pdf", fixture: SCANNED },
    ])
    try {
      const c = await scanAndClassifySource(source, raw, undefined, undefined, undefined, VISION_ID)
      expect(c).not.toBeNull()
      expect(c!.markitdownFiles).toEqual([])
      expect(c!.visionFiles.map((f) => path.basename(f.src)).sort()).toEqual(["digital.pdf", "scan.pdf"])
      expect(c!.ocrFiles).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("tesseract selection: digital + scanned PDFs → ocrFiles", async () => {
    const { root, source, raw } = stageSource("tess", [
      { rel: "digital.pdf", fixture: DIGITAL },
      { rel: "scan.pdf", fixture: SCANNED },
    ])
    try {
      const c = await scanAndClassifySource(source, raw, undefined, undefined, undefined, "tesseract-local")
      expect(c).not.toBeNull()
      expect(c!.markitdownFiles).toEqual([])
      expect(c!.ocrFiles.map((f) => path.basename(f.src)).sort()).toEqual(["digital.pdf", "scan.pdf"])
      expect(c!.visionFiles).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("none selection: PDFs → copyFiles, kept as-is", async () => {
    const { root, source, raw } = stageSource("none", [{ rel: "digital.pdf", fixture: DIGITAL }])
    try {
      const c = await scanAndClassifySource(source, raw, undefined, undefined, undefined, "none")
      expect(c).not.toBeNull()
      expect(c!.markitdownFiles).toEqual([])
      expect(c!.copyFiles.map((f) => path.basename(f.src))).toEqual(["digital.pdf"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("runImportWorkflow gates and copy phase", () => {
  function classifiedWith(logsDir: string, raw: string): {
    directFiles: ClassifiedEntry[]
    markitdownFiles: ClassifiedEntry[]
    visionFiles: ClassifiedEntry[]
    ocrFiles: ClassifiedEntry[]
    copyFiles: ClassifiedEntry[]
    logsDir: string
  } {
    const office = path.join(raw, "..", "office.docx")
    writeFileSync(office, "PK-fake-docx")
    const kept = path.join(raw, "..", "keep.pdf")
    copyFileSync(SCANNED, kept)
    return {
      directFiles: [],
      markitdownFiles: [],
      visionFiles: [],
      ocrFiles: [],
      copyFiles: [{ src: kept, rel: "keep.pdf", dest: path.join(raw, "keep.pdf") }],
      logsDir,
    }
  }

  test("copy phase keeps files byte-identical without any engine", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-copyphase-"))
    try {
      const raw = path.join(root, "raw")
      mkdirSync(raw, { recursive: true })
      const logsDir = path.join(root, ".logs")
      mkdirSync(logsDir, { recursive: true })
      const classified = classifiedWith(logsDir, raw)
      const results = await runImportWorkflow(classified, {})
      expect(results.copy.converted).toBe(1)
      expect(results.copy.failed).toBe(0)
      expect(existsSync(path.join(raw, "keep.pdf"))).toBe(true)
      expect(readFileSync(path.join(raw, "keep.pdf")).equals(readFileSync(classified.copyFiles[0]!.src))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("declining the markitdown gate leaves pdf/vision/ocr buckets intact", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-gatedecline-"))
    try {
      const raw = path.join(root, "raw")
      mkdirSync(raw, { recursive: true })
      const logsDir = path.join(root, ".logs")
      mkdirSync(logsDir, { recursive: true })
      const src = path.join(root, "digital.pdf")
      copyFileSync(DIGITAL, src)
      const dest = path.join(raw, "digital__pdf.md")
      const classified = {
        directFiles: [] as ClassifiedEntry[],
        markitdownFiles: [{ src: path.join(root, "office.docx"), rel: "office.docx", dest: path.join(raw, "office__docx.md") }] as ClassifiedEntry[],
        visionFiles: [] as ClassifiedEntry[],
        ocrFiles: [{ src, rel: "digital.pdf", dest }] as ClassifiedEntry[],
        logsDir,
      }
      writeFileSync(classified.markitdownFiles[0]!.src, "PK-fake")
      const seen: string[] = []
      const results = await runImportWorkflow(classified, {
        beforePhase: async (id) => {
          seen.push(id)
          // User declines MarkItDown but accepts everything else.
          return id !== "markitdown"
        },
      })
      expect(seen).toContain("pdf")
      expect(results.markitdown.converted).toBe(0)
      // The declined phase drops nothing: the PDF still converts in its own step.
      expect(results.pdf.converted).toBe(1)
      expect(existsSync(dest)).toBe(true)
      // Multi-page digital PDFs land as an index + splits; text is in the splits.
      expect(readFileSync(path.join(raw, "digital__pdf", "page-001.md"), "utf-8")).toContain("embedded digital text")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
