import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from "node:fs"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { copySource } from "../src/import/pipeline"
import type { ClassifiedEntry } from "../src/import/pipeline"
import { loadManifest } from "../src/import/manifest"

function makePdfWithText(): Buffer {
  const body = `BT /F1 24 Tf 50 150 Td (Resume digital hello) Tj ET`
  const parts: string[] = ["%PDF-1.4\n"]
  const offsets: number[] = [0]
  const addObj = (num: number, b: string) => {
    offsets[num] = Buffer.byteLength(parts.join(""))
    parts.push(`${num} 0 obj\n${b}\nendobj\n`)
  }
  addObj(1, `<</Type/Catalog/Pages 2 0 R>>`)
  addObj(2, `<</Type/Pages/Kids[3 0 R]/Count 1>>`)
  addObj(3, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>`)
  addObj(4, `<</Length ${Buffer.byteLength(body, "utf-8")}>>\nstream\n${body}\nendstream`)
  addObj(5, `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`)
  const total = 6
  const xrefPos = Buffer.byteLength(parts.join(""))
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  parts.push(xref)
  parts.push(`trailer\n<</Size ${total}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`)
  return Buffer.from(parts.join(""), "utf-8")
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-resume-"))
  const source = path.join(root, "source")
  const raw = path.join(root, "raw")
  mkdirSync(source, { recursive: true })
  writeFileSync(path.join(source, "note.txt"), "version one\n")
  writeFileSync(path.join(source, "digital.pdf"), makePdfWithText())
  writeFileSync(path.join(source, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]))
  return { root, source, raw }
}

async function runCopy(source: string, raw: string, logs: string[]) {
  return copySource(source, raw, {
    batchManager: undefined,
    markitdownChoice: true,
    ocrChoice: true,
    onLog: (m) => logs.push(m),
  })
}

describe("import resume via manifest", () => {
  test("second identical run processes nothing; records persist", async () => {
    const { root, source, raw } = makeFixture()
    try {
      const firstLogs: string[] = []
      const first = await runCopy(source, raw, firstLogs)
      expect(first.stillMissing).toBe(0)
      const { records } = loadManifest(path.join(root, ".logs"))
      expect(records.size).toBe(3)
      expect([...records.values()].every((r) => r.status === "done")).toBe(true)

      const secondLogs: string[] = []
      const second = await runCopy(source, raw, secondLogs)
      expect(second.mdConverted + second.ocrConverted).toBe(0)
      expect(secondLogs.some((l) => l.includes("Resume:") && l.includes("3 already imported"))).toBe(true)
      // Manifest still has exactly the 3 records (idempotent).
      expect(loadManifest(path.join(root, ".logs")).records.size).toBe(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("edited file re-processes alone; deleted source prunes; deleted output recovers", async () => {
    const { root, source, raw } = makeFixture()
    try {
      await runCopy(source, raw, [])
      // Edit one file (different size ⇒ fingerprint mismatch guaranteed).
      const note = path.join(source, "note.txt")
      writeFileSync(note, "version one\nversion two is longer\n")
      const future = new Date(Date.now() + 10_000)
      utimesSync(note, future, future)

      const editLogs: string[] = []
      const edited = await runCopy(source, raw, editLogs)
      expect(edited.copied).toBe(1)
      expect(editLogs.some((l) => l.includes("Resume:") && l.includes("1 changed"))).toBe(true)
      expect(readFileSync(path.join(raw, "note__txt.md"), "utf-8")).toContain("version two")

      // Delete a source file → pruned from tracking, not re-processed.
      rmSync(path.join(source, "img.png"))
      const pruneLogs: string[] = []
      await runCopy(source, raw, pruneLogs)
      expect(pruneLogs.some((l) => l.includes("1 removed (pruned)"))).toBe(true)
      expect(loadManifest(path.join(root, ".logs")).records.has("img.png")).toBe(false)

      // Delete a delivered output by hand → re-processed (recovered).
      // Text PDFs recover via the OCR digital path (pdf.js, no tesseract).
      rmSync(path.join(raw, "digital__pdf.md"))
      const recoverLogs: string[] = []
      const recovered = await runCopy(source, raw, recoverLogs)
      expect(recovered.ocrConverted).toBe(1)
      expect(existsSync(path.join(raw, "digital__pdf.md"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("resume model drift", () => {
  test("vision model change re-processes vision files; same model skips", async () => {
    const { applyResumeFilter } = await import("../src/import/pipeline")
    const { recordResult } = await import("../src/import/manifest")
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-resumedrift-"))
    try {
      const logsDir = path.join(root, ".logs")
      mkdirSync(logsDir, { recursive: true })
      const src = path.join(root, "img.png")
      writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      const dest = path.join(root, "raw", "img__png.md")
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, "# transcript\n")
      recordResult({ logsDir, rel: "img.png", ext: "png", route: "vision", status: "done", srcFile: src, dest, engine: "vision:model-a", model: "openai/gpt-4o" })

      const buckets = (): {
        directFiles: ClassifiedEntry[]
        markitdownFiles: ClassifiedEntry[]
        visionFiles: ClassifiedEntry[]
        ocrFiles: ClassifiedEntry[]
        copyFiles: ClassifiedEntry[]
      } => ({
        directFiles: [],
        markitdownFiles: [],
        visionFiles: [{ src, rel: "img.png", dest }],
        ocrFiles: [],
        copyFiles: [],
      })
      // Same model → skipped.
      const same = applyResumeFilter(buckets(), logsDir, { modelId: "openai/gpt-4o" })
      expect(same.skippedUnchanged).toEqual(["img.png"])
      // Different model → re-processed with force.
      const moved = buckets()
      const drift = applyResumeFilter(moved, logsDir, { modelId: "openrouter/qwen:free" })
      expect(drift.rerouted).toEqual(["img.png"])
      expect(moved.visionFiles[0]!.force).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
