import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { runImportWorkflow } from "../src/import/import-workflow"
import type { ClassifiedEntry } from "../src/import/pipeline"

function tmpRoot(prefix: string) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

describe("runImportWorkflow", () => {
  test("runs direct then markitdown through the shared registry", async () => {
    const root = tmpRoot("spinosa-workflow-")
    const srcDir = path.join(root, "src")
    const destDir = path.join(root, "dest")
    const logsDir = path.join(root, "logs")
    mkdirSync(srcDir)
    mkdirSync(destDir)
    mkdirSync(logsDir)

    const mdSrc = path.join(srcDir, "note.md")
    writeFileSync(mdSrc, "# hi\n")
    const jsonSrc = path.join(srcDir, "data.json")
    writeFileSync(jsonSrc, JSON.stringify({ ok: true }))

    const directFiles: ClassifiedEntry[] = [
      { src: mdSrc, rel: "note.md", dest: path.join(destDir, "note.md") },
    ]
    const markitdownFiles: ClassifiedEntry[] = [
      { src: jsonSrc, rel: "data.json", dest: path.join(destDir, "data.md") },
    ]

    const order: string[] = []
    const result = await runImportWorkflow(
      { directFiles, markitdownFiles, visionFiles: [], ocrFiles: [], logsDir },
      {
        beforePhase: (id) => {
          order.push(id)
          return true
        },
      },
    )

    expect(order).toEqual(["direct", "markitdown"])
    expect(result.direct.converted).toBe(1)
    expect(result.markitdown.converted).toBe(1)
    expect(result.vision.converted).toBe(0)
    expect(result.ocr.converted).toBe(0)
  })
})
