import { describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { MarkItDown } from "@spinosa/markitdown"
import { addFiles } from "../src/commands/add"

test("OCR no-output preserves existing converted outputs", async () => {
  // Use a scanned PDF for OCR failure — images are now copy-only (not OCR)
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-add-"))
  const source = path.join(root, "input.pdf")
  const output = path.join(root, "raw")
  const dest = path.join(output, "input__pdf.md")
  const pages = path.join(output, "input__pdf_pages")
  mkdirSync(pages, { recursive: true })
  writeFileSync(source, Buffer.from("%PDF-1.4\n% invalid scanned pdf\n"))
  writeFileSync(dest, "old")
  writeFileSync(path.join(pages, "page-001.md"), "old page")
  try {
    const result = await addFiles({ workspacePath: root, sourcePath: source, sourceIsDir: false, overwrite: true })
    expect(result.ocrFailed).toBe(1)
    expect(readFileSync(dest, "utf8")).toBe("old")
    expect(readFileSync(path.join(pages, "page-001.md"), "utf8")).toBe("old page")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("image copy-only preserves existing and counts as copied", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-add-"))
  const source = path.join(root, "input.png")
  const output = path.join(root, "raw")
  const dest = path.join(output, "input.png")
  mkdirSync(output, { recursive: true })
  writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  writeFileSync(dest, "old image")
  // Without overwrite, image copy should be skipped, not ocrFailed
  const result = await addFiles({ workspacePath: root, sourcePath: source, sourceIsDir: false, overwrite: false })
  expect(result.skipped).toBe(1)
  expect(result.ocrFailed).toBe(0)
  expect(readFileSync(dest, "utf8")).toBe("old image")
  rmSync(root, { recursive: true, force: true })
})

describe("single-file converted overwrite", () => {
  test("restores Markdown and page output when conversion fails", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-add-"))
    const source = path.join(root, "input.docx")
    const output = path.join(root, "raw")
    const dest = path.join(output, "input__docx.md")
    const pages = path.join(output, "input__docx_pages")
    mkdirSync(pages, { recursive: true })
    writeFileSync(source, "source")
    writeFileSync(dest, "old")
    writeFileSync(path.join(pages, "page-001.md"), "old page")
    const convert = MarkItDown.prototype.convert
    MarkItDown.prototype.convert = async () => { throw new Error("conversion failed") }
    try {
      const result = await addFiles({ workspacePath: root, sourcePath: source, sourceIsDir: false, overwrite: true })
      expect(result.mdFailed).toBe(1)
      expect(readFileSync(dest, "utf8")).toBe("old")
      expect(readFileSync(path.join(pages, "page-001.md"), "utf8")).toBe("old page")
      expect(existsSync(path.join(output, "input__docx.md.spinosa-backup"))).toBe(false)
    } finally {
      MarkItDown.prototype.convert = convert
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("replaces output after successful conversion without backups", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-add-"))
    const source = path.join(root, "input.docx")
    const output = path.join(root, "raw")
    const dest = path.join(output, "input__docx.md")
    writeFileSync(source, "source")
    mkdirSync(output, { recursive: true })
    writeFileSync(dest, "old")
    const convert = MarkItDown.prototype.convert
    MarkItDown.prototype.convert = async () => ({ markdown: "new" }) as never
    try {
      const result = await addFiles({ workspacePath: root, sourcePath: source, sourceIsDir: false, overwrite: true })
      expect(result.mdConverted).toBe(1)
      expect(readFileSync(dest, "utf8")).toContain("new")
      expect(existsSync(path.join(output, "input__docx_pages"))).toBe(false)
      expect((await import("node:fs/promises")).readdir(output).then(files => files.filter(name => name.includes("spinosa-backup")).length)).resolves.toBe(0)
    } finally {
      MarkItDown.prototype.convert = convert
      rmSync(root, { recursive: true, force: true })
    }
  })

})
