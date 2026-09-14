import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { spinosaLogInfo } from "@spinosa/core/utils/log"
import { setActiveWorkspacePath, tuiLog } from "../../src/spinosa/log"
import { dbg } from "../../src/util/debug-log"
import { stat } from "node:fs/promises"

describe("Spinosa logging", () => {
  test("respects SPINOSA_HOME and avoids full workspace paths", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = path.join(tmp.path, "spinosa-home")
    const workspace = path.join(tmp.path, "private", "workspace-name")
    try {
      setActiveWorkspacePath(workspace)
      tuiLog(`opened ${workspace}`)
      spinosaLogInfo("test", `workspacePath=${workspace} token=private-value`)
      dbg("test", {
        directory: workspace,
        authorization: "Bearer private-value",
        nested: { password: "private-value" },
      })

      const tuiText = await Bun.file(path.join(process.env.SPINOSA_HOME, "logs", "tui.ndjson")).text()
      const coreText = await Bun.file(path.join(process.env.SPINOSA_HOME, "logs", "spinosa.log")).text()
      const debugPath = path.join(process.env.SPINOSA_HOME, "logs", "debug.ndjson")
      const debugText = await Bun.file(debugPath).text()
      expect(tuiText).toContain('"ws":"workspace-name"')
      expect(tuiText).not.toContain(workspace)
      expect(coreText).toContain("component=test")
      expect(coreText).not.toContain(workspace)
      expect(coreText).not.toContain("private-value")
      expect(debugText).not.toContain(workspace)
      expect(debugText).not.toContain("private-value")
      if (process.platform !== "win32") {
        expect((await stat(path.dirname(debugPath))).mode & 0o777).toBe(0o700)
        expect((await stat(debugPath)).mode & 0o777).toBe(0o600)
        expect((await stat(path.join(process.env.SPINOSA_HOME, "logs", "tui.ndjson"))).mode & 0o777).toBe(0o600)
        expect((await stat(path.join(process.env.SPINOSA_HOME, "logs", "spinosa.log"))).mode & 0o777).toBe(0o600)
      }
    } finally {
      setActiveWorkspacePath(undefined)
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })

  test("persistImportWizardLogLines writes wizard detail into tui.ndjson", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = path.join(tmp.path, "spinosa-home")
    try {
      const { persistImportWizardLogLines } = await import("../../src/spinosa/log")
      persistImportWizardLogLines(
        ["[diag] direct=1 markitdown=0 ocr=1", "OCR: Processing 1 files", ""],
        "import-wizard-test",
      )
      const tuiText = await Bun.file(path.join(process.env.SPINOSA_HOME, "logs", "tui.ndjson")).text()
      expect(tuiText).toContain("import-wizard-test")
      expect(tuiText).toContain("[diag] direct=1 markitdown=0 ocr=1")
      expect(tuiText).toContain("OCR: Processing 1 files")
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })
})
