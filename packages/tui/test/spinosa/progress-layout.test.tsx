/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { DEFAULT_THEMES, resolveTheme } from "../../src/theme"
import { ProgressBar } from "../../src/routes/spinosa/wizard-ui"
import type { ImportFileProgressItem } from "../../src/spinosa/import-progress-ui"

const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")

async function renderBar(files: ImportFileProgressItem[]): Promise<string> {
  const app = await testRender(
    () => (
      <ProgressBar
        theme={theme}
        current={5}
        total={12}
        status="Transcribing images"
        fileName=""
        files={files}
        barWidth={20}
        viewportHeight={40}
      />
    ),
    { width: 80, height: 30 },
  )
  try {
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

function filesRowIndex(frame: string): number {
  return frame.split("\n").findIndex((line) => line.includes("Files ("))
}

test("current-file row reserves space so the list never jumps", async () => {
  const busy = await renderBar([
    { rel: "corpus/a.pdf", status: "processing", page: 3 },
    { rel: "corpus/b.md", status: "queued" },
  ])
  // Gap between files: nothing processing, run not complete.
  const idle = await renderBar([
    { rel: "corpus/a.pdf", status: "done" },
    { rel: "corpus/b.md", status: "queued" },
  ])
  expect(busy).toContain("(PG: 3)")
  expect(filesRowIndex(busy)).toBeGreaterThanOrEqual(0)
  // The Files list sits on the same row whether or not a file is active.
  expect(filesRowIndex(idle)).toBe(filesRowIndex(busy))
})
