import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ImportBatchManager } from "../src/import/batch"
import { scanSource } from "../src/scan/scanner"

describe("source scan progress", () => {
  test("reports each file and the scan total", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-scan-progress-"))
    const source = path.join(root, "source")
    mkdirSync(source)
    writeFileSync(path.join(source, "a.md"), "# A\n")
    writeFileSync(path.join(source, "b.md"), "# B\n")
    const events: Array<{ filePath: string; current: number; total: number }> = []

    try {
      await scanSource(source, new ImportBatchManager(), (event) => events.push(event))
      expect(events).toHaveLength(2)
      expect(events.map((event) => event.current).sort()).toEqual([1, 2])
      expect(events.every((event) => event.total === 2)).toBe(true)
      expect(events.every((event) => event.filePath.startsWith(source))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("aborts classification when requested", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-scan-cancel-"))
    const source = path.join(root, "source")
    mkdirSync(source)
    writeFileSync(path.join(source, "a.md"), "# A\n")
    writeFileSync(path.join(source, "b.md"), "# B\n")
    let abort = false

    try {
      await expect(scanSource(
        source,
        new ImportBatchManager(),
        (event) => { if (event.current === 1) abort = true },
        () => abort,
      )).rejects.toThrow("Source scan cancelled")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
