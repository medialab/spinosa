import { describe, expect, test } from "bun:test"
import { BINARY_COPYABLE_EXTENSIONS, MARKDOWN_EXTENSIONS, MARKITDOWN_EXTENSIONS } from "../src/constants"
import { scanClassifySourceFile } from "../src/extension/classifier"

describe("markitdown supported extensions", () => {
  test("pptx is not claimed as markitdown-supported", async () => {
    expect(MARKITDOWN_EXTENSIONS).not.toContain("pptx")
    expect(await scanClassifySourceFile("/tmp/deck.pptx")).toBe("unknown")
  })

  test("docx remains markitdown-routed", async () => {
    expect(MARKITDOWN_EXTENSIONS).toContain("docx")
    expect(await scanClassifySourceFile("/tmp/report.docx")).toBe("markitdown")
  })

  test("only markitdown-ts-proven formats stay markitdown-routed", async () => {
    // markitdown-ts@0.0.10 converters verified live 2026-09-12: PlainText
    // (text/* MIME only), Html, Docx, Xlsx (.xlsx only), Pdf, Image,
    // Wav/Mp3, Zip. Everything else throws "not supported".
    for (const ext of ["docx", "xlsx", "html", "htm", "zip", "csv"]) {
      expect(MARKITDOWN_EXTENSIONS).toContain(ext)
      expect(await scanClassifySourceFile(`/tmp/file.${ext}`)).toBe("markitdown")
    }
  })

  test("markitdown-rejected text formats route direct", async () => {
    // json (application/json) and xml (application/xml) throw in
    // markitdown-ts; direct copy keeps them byte-identical.
    for (const ext of ["json", "xml"]) {
      expect(MARKITDOWN_EXTENSIONS).not.toContain(ext)
      expect(MARKDOWN_EXTENSIONS).toContain(ext)
      expect(await scanClassifySourceFile(`/tmp/file.${ext}`)).toBe("markdown")
    }
  })

  test("markitdown-rejected binaries route binary_copyable", async () => {
    // No epub/xls/msg converter exists in markitdown-ts; originals are kept
    // byte-identical instead of failing the markitdown step.
    for (const ext of ["epub", "xls", "msg"]) {
      expect(MARKITDOWN_EXTENSIONS).not.toContain(ext)
      expect(BINARY_COPYABLE_EXTENSIONS).toContain(ext)
      expect(await scanClassifySourceFile(`/tmp/file.${ext}`)).toBe("binary_copyable")
    }
  })
})
