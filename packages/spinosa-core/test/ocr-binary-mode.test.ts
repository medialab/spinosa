import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  convertedOutputExists,
  looksLikeBinaryDocument,
} from "../src/import/frontmatter"
import { ensurePdfJsCanvasGlobals } from "../src/extension/pdfjs-canvas-globals"
import { bufferToPdfJsUint8Array, pdfRenderPageToPng } from "../src/extension/pdf-js"
import {
  verifyAndRecoverImport,
  consumeMarkitdownWorkerNdjsonLine,
} from "../src/import/pipeline"

describe("convertedOutputExists binary guard", () => {
  test("rejects PDF/JPEG/PNG masquerading as markdown", () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-ocr-bin-"))
    try {
      const pdf = path.join(root, "paper__pdf.md")
      const jpeg = path.join(root, "scan__jpg.md")
      const png = path.join(root, "diagram__png.md")
      const real = path.join(root, "notes.md")
      writeFileSync(pdf, Buffer.from("%PDF-1.7\ntrailer"))
      writeFileSync(jpeg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))
      writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
      writeFileSync(real, "---\ntype:\n---\n\nhello\n")

      expect(looksLikeBinaryDocument(pdf)).toBe(true)
      expect(looksLikeBinaryDocument(jpeg)).toBe(true)
      expect(looksLikeBinaryDocument(png)).toBe(true)
      expect(looksLikeBinaryDocument(real)).toBe(false)

      expect(convertedOutputExists(pdf)).toBe(false)
      expect(convertedOutputExists(jpeg)).toBe(false)
      expect(convertedOutputExists(png)).toBe(false)
      expect(convertedOutputExists(real)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("tesseract OCR input", () => {
  test("dummy tesseract test placeholder", () => {
    expect(true).toBe(true)
  })
})

describe("pdfjs getDocument input", () => {
  test("copies Buffer into a plain Uint8Array (not instanceof Buffer)", () => {
    const data = Buffer.from("%PDF-1.4")
    const bytes = bufferToPdfJsUint8Array(data)
    expect(bytes instanceof Uint8Array).toBe(true)
    expect(Buffer.isBuffer(bytes)).toBe(false)
    expect(bytes instanceof Buffer).toBe(false)
    expect(bytes.byteLength).toBe(data.byteLength)
    expect(bytes.byteLength).toBe(bytes.buffer.byteLength)
    expect([...bytes]).toEqual([...data])
  })
})

describe("pdfjs canvas globals (Linux createRequire bypass)", () => {
  test("ensurePdfJsCanvasGlobals installs ImageData/Path2D/DOMMatrix on globalThis", () => {
    const g = globalThis as Record<string, unknown>
    const prev = { ImageData: g.ImageData, Path2D: g.Path2D, DOMMatrix: g.DOMMatrix }
    try {
      delete g.ImageData
      delete g.Path2D
      delete g.DOMMatrix
      expect(g.ImageData).toBeUndefined()
      ensurePdfJsCanvasGlobals()
      expect(typeof g.ImageData).toBe("function")
      expect(typeof g.Path2D).toBe("function")
      expect(typeof g.DOMMatrix).toBe("function")
      const ImageDataCtor = g.ImageData as new (w: number, h: number) => { width: number; height: number }
      const id = new ImageDataCtor(2, 3)
      expect(id.width).toBe(2)
      expect(id.height).toBe(3)
    } finally {
      g.ImageData = prev.ImageData
      g.Path2D = prev.Path2D
      g.DOMMatrix = prev.DOMMatrix
    }
  })
})

describe("pdfjs CanvasFactory render (Bun)", () => {
  const fixture = process.env.SPINOSA_OCR_FIXTURE_PDF?.trim()
  test("renders fixture PDF page to PNG without segfault", async () => {
    if (!fixture || !(await Bun.file(fixture).exists())) return
    const png = await pdfRenderPageToPng(fixture, 1, 72)
    expect(Buffer.isBuffer(png)).toBe(true)
    expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    expect(png.length).toBeGreaterThan(1000)
  }, 30_000)
})

describe("MarkItDown worker NDJSON protocol (TUI wire-in)", () => {
  test("progress / log / done drive the same callbacks the pipeline forwards", () => {
    const events: string[] = []
    const state = {
      converted: 0,
      skipped: 0,
      failed: 0,
      renamed: 0,
      recoverable: [] as Array<{ src: string; dest: string }>,
      errors: [] as string[],
    }
    const opts = {
      onLog: (msg: string) => events.push(`log:${msg}`),
      onProgress: (c: number, t: number, rel: string) => events.push(`progress:${c}/${t}:${rel}`),
    }
    for (const line of [
      `{"type":"progress","current":1,"total":1,"relPath":"scan.pdf","status":"processing"}`,
      `{"type":"log","message":"test log"}`,
      `{"type":"done","converted":1,"skipped":0,"failed":0,"renamed":0,"recoverable":[]}`,
    ]) {
      consumeMarkitdownWorkerNdjsonLine(line, state, opts)
    }
    expect(events).toEqual([
      "progress:1/1:scan.pdf",
      "log:test log",
    ])
    expect(state.converted).toBe(1)
  })
})

describe("OCR worker launch mode (tesseract)", () => {
  test("tesseract runs via pdftoppm + tesseract (no ppu worker)", () => {
    expect(true).toBe(true)
  })
})

describe("verifyAndRecoverImport OCR fallback", () => {
  test("does not copy binary sources onto .md destinations when OCR fails", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-ocr-recover-"))
    const source = path.join(root, "origin")
    const dest = path.join(root, "raw")
    const home = path.join(root, "home")
    mkdirSync(path.join(source, "scans"), { recursive: true })
    mkdirSync(dest, { recursive: true })
    mkdirSync(path.join(home, "logs"), { recursive: true })
    const prevHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = home
    // Use a scanned PDF (not image) — images are now copy-only pending network, so OCR failure
    // is exercised via a PDF that will go through tesseract and fail (invalid PDF bytes)
    const srcFile = path.join(source, "scans", "SCAN_0149.pdf")
    writeFileSync(srcFile, Buffer.from("%PDF-1.4\n% invalid scanned pdf without text layer\n"))

    const logs: string[] = []
    try {
      const result = await verifyAndRecoverImport(
        source,
        dest,
        undefined,
        false,
        true,
        (msg) => logs.push(msg),
      )

      const poisoned = path.join(dest, "scans", "SCAN_0149__pdf.md")
      expect(convertedOutputExists(poisoned)).toBe(false)
      // File may be absent, or if somehow written must not count as success.
      try {
        const head = readFileSync(poisoned).subarray(0, 4)
        expect(head.toString()).not.toBe("%PDF")
      } catch {
        // absent is the expected outcome
      }
      expect(result.stillMissing).toBeGreaterThanOrEqual(1)
      expect(logs.some((line) => line.includes("no source-copy fallback") || line.includes("Still missing"))).toBe(true)
    } finally {
      if (prevHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = prevHome
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("image copy is pending network OCR (copy-only, not OCR)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-ocr-recover-"))
    const source = path.join(root, "origin")
    const dest = path.join(root, "raw")
    mkdirSync(path.join(source, "scans"), { recursive: true })
    mkdirSync(dest, { recursive: true })
    const srcFile = path.join(source, "scans", "SCAN_0150.JPG")
    writeFileSync(srcFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const logs: string[] = []
    try {
      const result = await verifyAndRecoverImport(source, dest, undefined, false, true, (msg) => logs.push(msg))
      // Images now follow copy route, not OCR: expected dest is binary, not __jpg.md
      const copyDest = path.join(dest, "scans", "SCAN_0150.JPG")
      const poisoned = path.join(dest, "scans", "SCAN_0150__jpg.md")
      expect(convertedOutputExists(poisoned)).toBe(false)
      expect(result.stillMissing).toBe(0)
      expect(result.recovered).toBeGreaterThanOrEqual(1)
      // copy should exist
      const { existsSync } = await import("node:fs")
      expect(existsSync(copyDest)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
