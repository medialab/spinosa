import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { importRouteForFile } from "../src/extension/classifier"
import { scanAndClassifySource, processOcr, processMarkitdown, processDirectCopy, verifyAndRecoverImport } from "../src/import/pipeline"
import { processVisionInProcess } from "../src/import/vision-transcribe"
import { addFiles } from "../src/commands/add"
import type { ClassifiedEntry } from "../src/import/pipeline"

const VISION_ID = "openai/gpt-4o-mini"

/** Minimal valid PDF with programmatic xref. Text pages carry /Font + Tj text (digital); rect pages carry no text (scanned-style). */
function makePdf(pageBodies: string[], withFont: boolean): Buffer {
  const n = pageBodies.length
  const fontObj = 3 + 2 * n
  const parts: string[] = ["%PDF-1.4\n"]
  const offsets: number[] = [0]
  const addObj = (num: number, body: string) => {
    offsets[num] = Buffer.byteLength(parts.join(""))
    parts.push(`${num} 0 obj\n${body}\nendobj\n`)
  }
  const kids = pageBodies.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")
  addObj(1, `<</Type/Catalog/Pages 2 0 R>>`)
  addObj(2, `<</Type/Pages/Kids[${kids}]/Count ${n}>>`)
  pageBodies.forEach((stream, i) => {
    const pageObj = 3 + 2 * i
    const contentObj = 4 + 2 * i
    const resources = withFont ? `/Resources<</Font<</F1 ${fontObj} 0 R>>>>` : ""
    addObj(pageObj, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]${resources}/Contents ${contentObj} 0 R>>`)
    addObj(contentObj, `<</Length ${Buffer.byteLength(stream, "utf-8")}>>\nstream\n${stream}\nendstream`)
  })
  if (withFont) addObj(fontObj, `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`)
  const total = fontObj + 1
  const xrefPos = Buffer.byteLength(parts.join(""))
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  parts.push(xref)
  parts.push(`trailer\n<</Size ${total}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`)
  return Buffer.from(parts.join(""), "utf-8")
}

const digitalPdf = () => makePdf([`BT /F1 24 Tf 50 150 Td (Hello digital world) Tj ET`], true)
const scannedPdf = (pages = 2) =>
  makePdf(Array.from({ length: pages }, () => `0.5 g 50 50 200 200 re f`), false)

describe("importRouteForFile — PDF/image triage by OCR selection", () => {
  test("images: vision → vision, tesseract/none/legacy → copy", async () => {
    expect(await importRouteForFile("/s/a.png", { ocrChoice: true, ocrModelId: VISION_ID })).toBe("vision")
    expect(await importRouteForFile("/s/a.png", { ocrChoice: true, ocrModelId: "tesseract-local" })).toBe("copy")
    expect(await importRouteForFile("/s/a.png", { ocrChoice: true, ocrModelId: "none" })).toBe("copy")
    expect(await importRouteForFile("/s/a.png", { ocrChoice: true })).toBe("copy")
  })

  test("PDFs: vision → vision, none → copy, tesseract/legacy → ocr", async () => {
    expect(await importRouteForFile("/s/doc.pdf", { ocrChoice: true, ocrModelId: VISION_ID })).toBe("vision")
    expect(await importRouteForFile("/s/doc.pdf", { ocrChoice: true, ocrModelId: "none" })).toBe("copy")
    expect(await importRouteForFile("/s/doc.pdf", { ocrChoice: true, ocrModelId: "tesseract-local" })).toBe("ocr")
    expect(await importRouteForFile("/s/doc.pdf", { ocrChoice: true })).toBe("ocr")
  })

  test("no ocrChoice → undefined regardless of selection", async () => {
    expect(await importRouteForFile("/s/doc.pdf", { ocrChoice: false, ocrModelId: VISION_ID })).toBeUndefined()
    expect(await importRouteForFile("/s/a.png", { ocrChoice: false, ocrModelId: "none" })).toBeUndefined()
  })
})

describe("scanAndClassifySource — bucket routing", () => {
  function makeSource(): { root: string; source: string; raw: string } {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-routing-"))
    const source = path.join(root, "source")
    const raw = path.join(root, "raw")
    mkdirSync(source, { recursive: true })
    writeFileSync(path.join(source, "doc.pdf"), scannedPdf(1))
    writeFileSync(path.join(source, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { root, source, raw }
  }

  test("vision selection: PDFs + images → visionFiles", async () => {
    const { root, source, raw } = makeSource()
    try {
      const c = await scanAndClassifySource(source, raw, undefined, undefined, undefined, VISION_ID)
      expect(c).not.toBeNull()
      expect(c!.visionFiles.map((f) => path.basename(f.src)).sort()).toEqual(["doc.pdf", "img.png"])
      expect(c!.ocrFiles).toEqual([])
      expect(c!.copyFiles).toEqual([])
      expect(c!.visionFiles[0]!.dest.endsWith("__pdf.md")).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("none: PDFs + images → copyFiles (kept as-is, never dropped)", async () => {
    const { root, source, raw } = makeSource()
    try {
      const c = await scanAndClassifySource(source, raw, undefined, undefined, undefined, "none")
      expect(c).not.toBeNull()
      expect(c!.copyFiles.map((f) => path.basename(f.src)).sort()).toEqual(["doc.pdf", "img.png"])
      expect(c!.visionFiles).toEqual([])
      expect(c!.ocrFiles).toEqual([])
      // copy dest keeps the original filename
      expect(c!.copyFiles.find((f) => f.src.endsWith(".pdf"))!.dest.endsWith("doc.pdf")).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("tesseract/legacy: PDF → ocrFiles, image → copyFiles", async () => {
    for (const model of ["tesseract-local", undefined]) {
      const { root, source, raw } = makeSource()
      try {
        const c = await scanAndClassifySource(source, raw, undefined, undefined, undefined, model)
        expect(c).not.toBeNull()
        expect(c!.ocrFiles.map((f) => path.basename(f.src))).toEqual(["doc.pdf"])
        expect(c!.copyFiles.map((f) => path.basename(f.src))).toEqual(["img.png"])
        expect(c!.visionFiles).toEqual([])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})

describe("processOcr — digital PDFs via pdf.js without tesseract", () => {
  test("digital PDF extracts text even when tesseract is unavailable", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-ocrdigital-"))
    const logsDir = path.join(root, ".logs")
    mkdirSync(logsDir, { recursive: true })
    const src = path.join(root, "digital.pdf")
    writeFileSync(src, digitalPdf())
    const dest = path.join(root, "raw", "digital__pdf.md")
    const files: ClassifiedEntry[] = [{ src, rel: "digital.pdf", dest }]
    const logs: string[] = []
    try {
      const res = await processOcr(files, logsDir, undefined, (m) => logs.push(m))
      expect(res.converted).toBe(1)
      expect(res.failed).toBe(0)
      expect(existsSync(dest)).toBe(true)
      expect(readFileSync(dest, "utf-8")).toContain("Hello digital world")
      expect(logs.some((l) => l.includes("pdf.js"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const hasPdftoppm = (() => {
  try {
    return typeof Bun !== "undefined" && !!Bun.which("pdftoppm")
  } catch {
    return false
  }
})()

describe("processVisionInProcess — scanned PDF page transcription", () => {
  test.if(hasPdftoppm)("multi-page scanned PDF → titled transcript + split pages", async () => {    const root = mkdtempSync(path.join(tmpdir(), "spinosa-visionpdf-"))
    const logsDir = path.join(root, ".logs")
    mkdirSync(logsDir, { recursive: true })
    const src = path.join(root, "scan.pdf")
    writeFileSync(src, scannedPdf(2))
    const dest = path.join(root, "raw", "scan__pdf.md")
    const files: ClassifiedEntry[] = [{ src, rel: "scan.pdf", dest }]
    const seen: string[] = []
    try {
      const res = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
        visionModelId: VISION_ID,
        transcribeVision: async (req) => {
          expect(req.providerID).toBe("openai")
          expect(req.image.mime).toBe("image/png")
          seen.push(req.image.data.slice(0, 8))
          return `transcript page ${seen.length}`
        },
      })
      expect(seen.length).toBe(2)
      expect(res.converted).toBe(1)
      expect(res.failed).toBe(0)
      const content = readFileSync(dest, "utf-8")
      expect(content).toContain("## Page 1")
      expect(content).toContain("## Page 2")
      expect(content).toContain("transcript page 1")
      const pageDir = dest.slice(0, -3)
      expect(existsSync(path.join(pageDir, "page-001.md"))).toBe(true)
      expect(existsSync(path.join(pageDir, "page-002.md"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  test.if(hasPdftoppm)("blank PDF page becomes placeholder, document survives", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-visionblank-"))
    const logsDir = path.join(root, ".logs")
    mkdirSync(logsDir, { recursive: true })
    const src = path.join(root, "scan.pdf")
    writeFileSync(src, scannedPdf(2))
    const dest = path.join(root, "raw", "scan__pdf.md")
    const files: ClassifiedEntry[] = [{ src, rel: "scan.pdf", dest }]
    let calls = 0
    try {
      const res = await processVisionInProcess(files, logsDir, undefined, undefined, undefined, {
        visionModelId: VISION_ID,
        transcribeVision: async () => {
          calls++
          return calls === 2 ? "   " : `transcript page ${calls}`
        },
      })
      expect(calls).toBe(2)
      expect(res.converted).toBe(1)
      expect(res.failed).toBe(0)
      const content = readFileSync(dest, "utf-8")
      expect(content).toContain("transcript page 1")
      expect(content).toContain("[No text detected on this page]")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("verifyAndRecoverImport — vision route", () => {  function makeSource(): { root: string; source: string; raw: string } {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-verifyvision-"))
    const source = path.join(root, "source")
    const raw = path.join(root, "raw")
    mkdirSync(source, { recursive: true })
    mkdirSync(raw, { recursive: true })
    writeFileSync(path.join(source, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { root, source, raw }
  }

  test("missing vision transcript → still missing, no auto-retry, no duplicate copy", async () => {
    const { root, source, raw } = makeSource()
    const logs: string[] = []
    try {
      const res = await verifyAndRecoverImport(source, raw, undefined, true, true, (m) => logs.push(m), undefined, raw, undefined, undefined, VISION_ID)
      expect(res.missing).toBe(1)
      expect(res.recovered).toBe(0)
      expect(res.stillMissing).toBe(1)
      expect(logs.some((l) => l.includes("no auto-retry"))).toBe(true)
      // No duplicate: the .md must NOT exist and no original copy may sit on the .md path
      expect(existsSync(path.join(raw, "img__png.md"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("present vision transcript → nothing missing", async () => {
    const { root, source, raw } = makeSource()
    try {
      writeFileSync(path.join(raw, "img__png.md"), "# img\n\ntranscript\n")
      const res = await verifyAndRecoverImport(source, raw, undefined, true, true, undefined, undefined, raw, undefined, undefined, VISION_ID)
      expect(res.missing).toBe(0)
      expect(res.stillMissing).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("none selection: PDF recovered via copy as-is", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-verifynone-"))
    const source = path.join(root, "source")
    const raw = path.join(root, "raw")
    mkdirSync(source, { recursive: true })
    mkdirSync(raw, { recursive: true })
    writeFileSync(path.join(source, "doc.pdf"), scannedPdf(1))
    try {
      const res = await verifyAndRecoverImport(source, raw, undefined, true, true, undefined, undefined, raw, undefined, undefined, "none")
      expect(res.stillMissing).toBe(0)
      expect(res.recovered).toBeGreaterThanOrEqual(1)
      expect(existsSync(path.join(raw, "doc.pdf"))).toBe(true)
      // …and no phantom .md was created for it
      expect(existsSync(path.join(raw, "doc__pdf.md"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("addFiles single-file — digital PDF via pdf.js, never MarkItDown", () => {
  test("single digital PDF extracts text without tesseract", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-addsingle-"))
    const workspace = path.join(root, "ws")
    mkdirSync(workspace, { recursive: true })
    const src = path.join(root, "digital.pdf")
    writeFileSync(src, digitalPdf())
    const logs: string[] = []
    try {
      const res = await addFiles({ workspacePath: workspace, sourcePath: src, onProgress: (m) => logs.push(m) })
      expect(res.ocrConverted).toBe(1)
      expect(res.failed).toBe(0)
      const dest = path.join(workspace, "raw", "digital__pdf.md")
      expect(existsSync(dest)).toBe(true)
      expect(readFileSync(dest, "utf-8")).toContain("Hello digital world")
      expect(logs.some((l) => l.includes("pdf.js"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("processMarkitdown — PDF fallback respects OCR selection", () => {
  function makePdfEntry(): { root: string; files: ClassifiedEntry[]; logsDir: string } {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-mdfallback-"))
    const logsDir = path.join(root, ".logs")
    mkdirSync(logsDir, { recursive: true })
    const src = path.join(root, "scan.pdf")
    writeFileSync(src, scannedPdf(1))
    const files: ClassifiedEntry[] = [{ src, rel: "scan.pdf", dest: path.join(root, "raw", "scan__pdf.md") }]
    return { root, files, logsDir }
  }

  test("vision selection: misrouted PDF fails honestly, no tesseract", async () => {
    const { root, files, logsDir } = makePdfEntry()
    const logs: string[] = []
    try {
      const res = await processMarkitdown(files, logsDir, undefined, (m) => logs.push(m), undefined, {
        inProcess: true,
        ocrModelId: VISION_ID,
      })
      expect(res.converted).toBe(0)
      expect(res.failed).toBe(1)
      expect(logs.some((l) => l.includes("vision") && l.includes("no tesseract fallback"))).toBe(true)
      expect(logs.some((l) => l.includes("tesseract OCR fallback succeeded"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("processDirectCopy — very long filenames", () => {
  test("240-char name rescues via truncate-rename with no retry rounds", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-longname-"))
    const raw = path.join(root, "raw")
    mkdirSync(path.join(root, "source", "07_edge_6"), { recursive: true })
    const longName = `${"a".repeat(230)}.txt`
    const src = path.join(root, "source", "07_edge_6", longName)
    writeFileSync(src, "edge content\n")
    const dest = path.join(raw, "07_edge_6", longName)
    const files: ClassifiedEntry[] = [{ src, rel: `07_edge_6/${longName}`, dest }]
    const logs: string[] = []
    const events: string[] = []
    const { ProgressEmitter } = await import("../src/progress/progress")
    const prog = new ProgressEmitter()
    prog.on((e) => events.push(`${e.phase}:${e.status}:${e.relPath}`))
    try {
      const res = await processDirectCopy(files, prog, (m) => logs.push(m))
      expect(res.converted).toBe(1)
      expect(res.failed).toBe(0)
      expect(res.renamed).toBe(1)
      // Rescue, not retry: no backoff rounds were burned on the doomed path.
      expect(logs.some((l) => l.includes("renamed (name too long)"))).toBe(true)
      expect(logs.some((l) => l.includes("retry"))).toBe(false)
      expect(events.some((e) => e.includes(":done:"))).toBe(true)
      expect(events.some((e) => e.includes(":failed:"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("copySource vision bucket", () => {
  test("vision files are preserved to _failed_files with a loud warning, never dropped", async () => {
    const { copySource } = await import("../src/import/pipeline")
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-copyvision-"))
    const source = path.join(root, "source")
    const raw = path.join(root, "raw")
    mkdirSync(source, { recursive: true })
    writeFileSync(path.join(source, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const logs: string[] = []
    try {
      const res = await copySource(source, raw, {
        batchManager: undefined,
        markitdownChoice: true,
        ocrChoice: true,
        ocrModelId: "openai/gpt-4o-mini",
        verifyAfter: false,
        onLog: (m) => logs.push(m),
      })
      expect(logs.some((l) => l.includes("need a vision model"))).toBe(true)
      expect(existsSync(path.join(raw, "_failed_files", "img.png"))).toBe(true)
      // Not counted as converted (no transcript exists).
      expect(res.copied).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("classifier byte truncation", () => {
  test("multibyte names fit 250 bytes per component", async () => {
    const { safeRelPaths } = await import("../src/extension/classifier")
    // 200 CJK chars = 600 bytes: must truncate by bytes, not chars.
    const rel = `${"文".repeat(200)}.txt`
    const [safe] = safeRelPaths([rel])
    expect(Buffer.byteLength(path.basename(safe!), "utf8")).toBeLessThanOrEqual(250)
    expect(safe!.endsWith(".txt")).toBe(true)
  })
})
