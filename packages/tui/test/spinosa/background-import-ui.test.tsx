/** @jsxImportSource @opentui/solid */
import { describe, expect, mock, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { BackgroundImportService } from "../../src/spinosa/import-background"
import { DialogBackgroundImport, openBackgroundImportMonitor } from "../../src/component/dialog-background-import"
import { BackgroundImportChip } from "../../src/component/background-import-chip"

describe("openBackgroundImportMonitor", () => {
  test("replace carries an Escape handler that closes without cancelling", async () => {
    await setup()
    let replaced: { onEscape?: () => void } | undefined
    let cleared = 0
    const fakeDialog = {
      replace: (_el: unknown, _onClose?: unknown, onEscape?: () => void) => {
        replaced = { onEscape }
      },
      clear: () => {
        cleared++
      },
      stack: [] as unknown[],
    }
    openBackgroundImportMonitor(fakeDialog as never)
    expect(replaced).toBeDefined()
    expect(typeof replaced!.onEscape).toBe("function")
    replaced!.onEscape!()
    expect(cleared).toBe(1)
  })
})

async function setup() {
  const { DEFAULT_THEMES, resolveTheme } = await import("../../src/theme")
  const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
  mock.module("../../src/context/theme", () => ({
    useTheme: () => ({ theme }),
  }))
  mock.module("../../src/ui/dialog", () => ({
    useDialog: () => ({
      clear() {},
      dismiss() {},
      replace() {},
      setSize() {},
      stack: [],
    }),
  }))
  mock.module("../../src/context/sync", () => ({
    useSync: () => ({
      data: { provider: [], provider_next: { all: [], connected: [] } },
      refreshProviders: async () => {},
    }),
  }))
  mock.module("../../src/context/sdk", () => ({
    useSDK: () => ({
      directory: "/tmp",
      client: { provider: { vision: { transcribe: async () => ({}) } } },
    }),
  }))
  mock.module("../../src/ui/toast", () => ({
    useToast: () => ({ show() {}, error() {} }),
  }))
  const { BackgroundImportProvider, useBackgroundImport } = await import(
    "../../src/spinosa/import-background"
  )
  return { BackgroundImportProvider, useBackgroundImport }
}

describe("background import monitor + chip", () => {
  test("monitor shows progress, pause actions, and summary", async () => {
    const { BackgroundImportProvider, useBackgroundImport } = await setup()
    let svc!: BackgroundImportService
    const app = await testRender(
      () => (
        <BackgroundImportProvider>
          {(() => {
            svc = useBackgroundImport()
            return <DialogBackgroundImport />
          })()}
        </BackgroundImportProvider>
      ),
      { width: 100, height: 40 },
    )
    try {
      svc.start({ kind: "onboarding", title: "t", workspacePath: "/tmp/ws", modelId: "openai/gpt-4o-mini" })
      svc.seedQueue(["a.png", "b.pdf"])
      svc.setPhase("vision")
      svc.reportStatus("Transcribing images & scanned PDFs via Vision Model — 2 files")
      svc.reportProgress({ relPath: "a.png", status: "processing" })
      await app.renderOnce()
      let frame = app.captureCharFrame()
      expect(frame).toContain("Importing")
      expect(frame).toContain("a.png")

      // Pause renders error + actions.
      void svc.onVisionFailure("a.png", "openai/gpt-4o-mini", "401 Incorrect API key")
      await app.renderOnce()
      frame = app.captureCharFrame()
      expect(frame).toContain("Authentication failed")
      expect(frame).toContain("Retry")
      expect(frame).toContain("Change model")

      // Retry clears the pause.
      svc.resolvePause("retry")
      await app.renderOnce()
      frame = app.captureCharFrame()
      expect(frame).not.toContain("Authentication failed")

      // Completion renders the summary + dismiss.
      svc.reportProgress({ relPath: "a.png", status: "done" })
      svc.reportProgress({ relPath: "b.pdf", status: "done" })
      svc.finish({ converted: 2, skipped: 0, failed: 0, renamed: 0, recovered: 0, stillMissing: 0, text: "2/2 vision", success: true })
      await app.renderOnce()
      frame = app.captureCharFrame()
      expect(frame).toContain("Import complete")
      expect(frame).toContain("2/2 vision")
      expect(frame).toContain("Dismiss")
      // Single file list: the ProgressBar no longer embeds its own rows.
      const filesHeaders = frame.split("\n").filter((line) => line.includes("Files"))
      expect(filesHeaders.length).toBeLessThanOrEqual(1)
    } finally {
      app.renderer.destroy()
      mock.restore()
    }
  })

  test("chip shows running/paused states", async () => {
    const { BackgroundImportProvider, useBackgroundImport } = await setup()
    let svc!: BackgroundImportService
    const app = await testRender(
      () => (
        <BackgroundImportProvider>
          {(() => {
            svc = useBackgroundImport()
            return <BackgroundImportChip />
          })()}
        </BackgroundImportProvider>
      ),
      { width: 100, height: 12 },
    )
    try {
      // Idle: chip hidden.
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Import running")

      svc.start({ kind: "add-files", title: "t", workspacePath: "/tmp/ws", modelId: "tesseract-local" })
      svc.seedQueue(["a.txt", "b.txt"])
      svc.reportProgress({ relPath: "a.txt", status: "done" })
      await app.renderOnce()
      let frame = app.captureCharFrame()
      expect(frame).toContain("Import running")
      expect(frame).toContain("50%")

      void svc.onVisionFailure("b.txt", "openai/gpt-4o", "500 boom")
      await app.renderOnce()
      frame = app.captureCharFrame()
      expect(frame).toContain("action needed")
      svc.resolvePause("skip")
      svc.dismiss()
    } finally {
      app.renderer.destroy()
      mock.restore()
    }
  })
})
