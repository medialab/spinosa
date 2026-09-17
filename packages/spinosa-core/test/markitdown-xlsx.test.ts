import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import * as XLSX from "xlsx"
import { MarkItDown } from "@spinosa/markitdown"
import { ensureSheetJsFs } from "../src/import/sheetjs-fs"
import { markitdownConvertFile } from "../src/import/markitdown-convert"

const fixtureRoot = process.env.SPINOSA_MARKITDOWN_FIXTURE_DIR?.trim()
const FIXTURES = fixtureRoot
  ? ["GESTION_DE_L_ENVIRONNEMENT.xlsx", "vivatech_subset.xlsx"].map((name) => path.join(fixtureRoot, name))
  : []

function writeMinimalXlsx(file: string): void {
  ensureSheetJsFs()
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ["name", "value"],
    ["alpha", 1],
    ["beta", 2],
  ])
  XLSX.utils.book_append_sheet(wb, ws, "Data")
  // Prefer buffer write so we don't depend on writeFile/set_fs for fixture creation.
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  writeFileSync(file, buf)
}

describe("markitdown xlsx (SheetJS ESM fs)", () => {
  test("path convert works after ensureSheetJsFs + buffer path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-xlsx-"))
    try {
      const file = path.join(root, "sample.xlsx")
      writeMinimalXlsx(file)
      const converter = new MarkItDown()
      const result = await markitdownConvertFile(converter, file)
      const md = result?.markdown ?? ""
      expect(md.length).toBeGreaterThan(0)
      expect(md).toContain("Data")
      expect(md).toMatch(/alpha/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("fixture xlsx files convert via markitdownConvertFile", async () => {
    const available = FIXTURES.filter((f) => existsSync(f))
    if (available.length === 0) return

    const converter = new MarkItDown()
    for (const file of available) {
      const result = await markitdownConvertFile(converter, file)
      const md = result?.markdown ?? ""
      expect(md.trim().length).toBeGreaterThan(0)
    }
  }, 60_000)
})
