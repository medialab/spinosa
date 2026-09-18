// Markdown → PDF export: structural validity plus content round-trip
// through the repo's own pdf.js text extraction (Skia subset-encodes text,
// so byte-searching the buffer is meaningless — extract and compare).
import { describe, expect, test, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { exportMarkdownToPdf, pdfHeadingSize, PDF_COVER_SIZE, PDF_BODY_SIZE } from "../src/export/markdown-pdf"
import { pdfExtractAllText, pdfExtractPageTexts } from "../src/extension/pdf"

const tmp = mkdtempSync(path.join(tmpdir(), "spinosa-pdf-export-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

async function renderToFile(name: string, markdown: string, opts?: { title?: string }): Promise<string> {
  const buf = await exportMarkdownToPdf(markdown, opts)
  const file = path.join(tmp, name)
  await Bun.write(file, buf)
  return file
}

const SAMPLE = `# Findings

Lead paragraph with **bold** and *italic* plus a [link](https://example.com/x).

## Evidence

- first item
- second item

> A quoted passage.

| Speaker | Status |
|---------|--------|
| SPEAKER_05 | pass |
`

describe("exportMarkdownToPdf", () => {
  test("keeps headings close to body size", () => {
    expect(PDF_COVER_SIZE).toBeLessThanOrEqual(16)
    expect(pdfHeadingSize(1)).toBeLessThanOrEqual(13)
    expect(pdfHeadingSize(2)).toBeLessThanOrEqual(12)
    expect(pdfHeadingSize(3)).toBe(PDF_BODY_SIZE + 1)
  })
  test("produces a structurally valid PDF", async () => {
    const buf = await exportMarkdownToPdf(SAMPLE, { title: "Validity Check" })
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  test("round-trips headings, lists, quotes, and tables", async () => {
    const file = await renderToFile("sample.pdf", SAMPLE, { title: "Roundtrip" })
    const text = await pdfExtractAllText(file)
    for (const expected of [
      "Roundtrip",
      "Findings",
      "Evidence",
      "first item",
      "second item",
      "A quoted passage",
      "Speaker",
      "SPEAKER_05",
      "pass",
    ]) {
      expect(text).toContain(expected)
    }
  })

  test("strips YAML frontmatter and uses it as the cover title", async () => {
    const file = await renderToFile(
      "frontmatter.pdf",
      `---\ntitle: Frontmatter Title\ntopic: excellence\n---\n\n# Body\n\nContent here.\n`,
    )
    const text = await pdfExtractAllText(file)
    expect(text).toContain("Frontmatter Title")
    expect(text).toContain("Body")
    expect(text).not.toContain("topic:")
  })

  test("long documents paginate across pages", async () => {
    const paras = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with enough words to fill several lines of body text on the page.`).join("\n\n")
    const file = await renderToFile("long.pdf", `# Long\n\n${paras}\n`)
    const pages = await pdfExtractPageTexts(file)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pages[0]!.text).toContain("Paragraph 0")
  })

  test("long tables paginate with repeated headers", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => `| SPEAKER_${String(i).padStart(2, "0")} | claim number ${i} | pass |`).join("\n")
    const file = await renderToFile("table.pdf", `# Table\n\n| Speaker | Claim | Status |\n|---|---|---|\n${rows}\n`)
    const pages = await pdfExtractPageTexts(file)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    const last = await pdfExtractAllText(file)
    expect(last).toContain("SPEAKER_79")
  })

  test("empty input still yields a valid PDF", async () => {
    const buf = await exportMarkdownToPdf("")
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
    const file = await renderToFile("empty.pdf", "")
    const pages = await pdfExtractPageTexts(file)
    expect(pages.length).toBeGreaterThanOrEqual(1)
  })
})
