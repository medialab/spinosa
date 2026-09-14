/**
 * Fully-scanned PDF fixtures with REAL raster text (guide #9).
 *
 * Local OCR was removed: a genuinely scanned PDF (rendered text page
 * embedded as a raster image XObject with no text layer) can no longer be
 * transcribed locally. This file proves the removal contract end-to-end:
 *   - the removal stub reports unavailable and throws honest errors
 *   - processPdf keeps the original + an honest placeholder (skipped, retryable)
 *   - nothing is ever marked done with faked text
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { tmpdir } from "node:os"
import * as path from "node:path"

const DIGITAL = path.join(import.meta.dir, "fixtures", "digital-3p.pdf")

/** Render a digital page to RGB bytes via the internal engine (canvas). */
async function renderPageRgb(png: Buffer, maxWidth: number): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas")
  const img = await loadImage(png)
  const scale = Math.min(1, maxWidth / img.width)
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, 0, 0, width, height)
  const rgba = ctx.getImageData(0, 0, width, height).data
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!
    rgb[j + 1] = rgba[i + 1]!
    rgb[j + 2] = rgba[i + 2]!
  }
  return { rgb, width, height }
}

/** Minimal one-page image-only PDF (no text layer): a synthetic scan. */
function imageOnlyPdf(rgb: Buffer, width: number, height: number): Buffer {
  const compressed = deflateSync(rgb)
  const draw = `q\n${width} 0 0 ${height} 0 0 cm\n/Im1 Do\nQ`
  // Build with byte-exact offsets (binary-safe).
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "utf-8")]
  const offs: number[] = [0]
  const push = (num: number, dict: string, stream?: Buffer) => {
    offs[num] = chunks.reduce((n, c) => n + c.byteLength, 0)
    chunks.push(Buffer.from(`${num} 0 obj\n${dict}\n`, "utf-8"))
    if (stream) {
      chunks.push(Buffer.from("stream\n", "utf-8"))
      chunks.push(stream)
      chunks.push(Buffer.from("\nendstream\n", "utf-8"))
    }
    chunks.push(Buffer.from("endobj\n", "utf-8"))
  }
  push(1, `<</Type/Catalog/Pages 2 0 R>>`)
  push(2, `<</Type/Pages/Kids[3 0 R]/Count 1>>`)
  push(3, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Resources<</XObject<</Im1 4 0 R>>>>/Contents 5 0 R>>`)
  push(4, `<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Length ${compressed.byteLength}/Filter/FlateDecode>>`, compressed)
  push(5, `<</Length ${Buffer.byteLength(draw, "utf-8")}>>`, Buffer.from(draw, "utf-8"))
  const total = 6
  const xrefPos = chunks.reduce((n, c) => n + c.byteLength, 0)
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) xref += `${String(offs[i]).padStart(10, "0")} 00000 n \n`
  chunks.push(Buffer.from(xref, "utf-8"))
  chunks.push(Buffer.from(`trailer\n<</Size ${total}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`, "utf-8"))
  return Buffer.concat(chunks)
}

async function makeScannedPdf(dir: string): Promise<string> {
  const { withPdfDocument } = await import("../src/extension/pdf-js")
  const { renderPage } = await import("../src/pdf/render")
  let png: Buffer | undefined
  await withPdfDocument(DIGITAL, async (doc) => {
    png = await renderPage(doc, 1)
  })
  if (!png) throw new Error("could not render digital fixture")
  const { rgb, width, height } = await renderPageRgb(png, 850)
  const out = path.join(dir, "synthetic-scan.pdf")
  writeFileSync(out, imageOnlyPdf(rgb, width, height))
  return out
}

describe("fully scanned PDF with real raster text (no local engine)", () => {
  test("platform gate reports unsupported with honest errors", async () => {
    const { isOcrPlatformSupported, ocrUnsupportedReason } = await import("../src/tools/ocr-support")
    expect(isOcrPlatformSupported()).toBe(false)
    expect(ocrUnsupportedReason()).toMatch(/vision model|copy/i)
    const { ocrAvailable } = await import("../src/tools/detection")
    expect(ocrAvailable()).toBe(false)
  })

  test("processPdf keeps the synthetic scan + honest placeholder (never faked text)", async () => {
    const { processPdf } = await import("../src/import/pipeline")
    const dir = mkdtempSync(path.join(tmpdir(), "spinosa-scanned-pipe-"))
    const logsDir = path.join(dir, ".logs")
    const raw = path.join(dir, "raw")
    const { mkdirSync } = await import("node:fs")
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(raw, { recursive: true })
    try {
      const scanned = await makeScannedPdf(dir)
      const dest = path.join(raw, "synthetic-scan__pdf.md")
      const res = await processPdf(
        [{ src: scanned, rel: "synthetic-scan.pdf", dest }],
        logsDir,
        undefined,
        undefined,
        undefined,
        { ocrModelId: undefined },
      )
      expect(res.failed).toBe(0)
      expect(res.converted).toBe(0)
      expect(res.skipped).toBe(1)
      expect(existsSync(path.join(raw, "synthetic-scan.pdf"))).toBe(true)
      const md = readFileSync(dest, "utf-8")
      expect(md).toContain("Local OCR was removed")
      expect(md.toLowerCase()).not.toContain("embedded digital text")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
